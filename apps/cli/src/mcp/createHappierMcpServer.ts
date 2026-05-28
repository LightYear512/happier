import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { HappyMcpSessionClient } from '@/mcp/startHappyServer';
import { logger } from '@/ui/logger';

import { registerHappierMcpResources } from '@/mcp/resources/registerHappierMcpResources';
import { createActionToolExecutorBridge } from '@/agent/tools/happierTools/createActionToolExecutorBridge';
import { createChangeTitleToolHandler } from '@/agent/tools/happierTools/createChangeTitleToolHandler';
import { createStartExecutionRunToolHandler } from '@/agent/tools/happierTools/createStartExecutionRunToolHandler';
import { normalizeExecutionRunRpcPayload } from '@/session/services/executionRuns';
import { registerHappierMcpBuiltInTools } from '@/mcp/server/registerHappierMcpBuiltInTools';
import type { Credentials } from '@/persistence';
import { createCliActionExecutorHarness } from '@/session/actions/createCliActionExecutorHarness';
import { createSessionDevPreviewRegistry, type SessionDevPreviewRegistry } from '@/session/devPreview/createSessionDevPreviewRegistry';
import { emitLocalServicePreviewMessage } from '@/session/devPreview/emitLocalServicePreviewMessage';
import {
  buildSimulatorPreviewPayload,
  emitSimulatorPreviewMessage,
} from '@/session/simulatorPreview/emitSimulatorPreviewMessage';
import {
  startAndroidScreenshotMjpegStream,
  type AndroidScreenshotMjpegStream,
} from '@/session/simulatorPreview/startAndroidScreenshotMjpegStream';
import { resolveSessionEncryptionContextFromCredentials } from '@/session/transport/encryption/sessionEncryptionContext';
import {
  PromptRegistryInstallRequestV1Schema,
  PromptRegistryInstallResponseV1Schema,
  type AccountSettings,
  getActionSpec,
  isActionSpecSurfacedOn,
  writeLocalServicePreviewToSessionMetadata,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { MemorySearchResultV1Schema, MemoryWindowV1Schema, type MemorySearchResultV1, type MemoryWindowV1 } from '@happier-dev/protocol';
import { createMcpActionApprovalRequirement, createMcpActionEnablement } from '@/mcp/server/createMcpActionEnablement';
import {
  registerDaemonSessionDevPreview,
  type DaemonDevPreviewRegisterRequest,
  type DaemonDevPreviewRegisterResult,
} from '@/daemon/controlClient';

export type AndroidSimulatorPreviewStreamRegistry = Map<string, AndroidScreenshotMjpegStream>;

export function createHappierMcpServer(
  client: HappyMcpSessionClient,
  opts?: Readonly<{
    credentials?: Credentials | null;
    accountSettings?: AccountSettings | null;
    devPreviewRegistry?: SessionDevPreviewRegistry | null;
    daemonDevPreviewRegister?: ((request: DaemonDevPreviewRegisterRequest) => Promise<DaemonDevPreviewRegisterResult>) | null;
    startAndroidSimulatorPreviewStream?: typeof startAndroidScreenshotMjpegStream;
    androidSimulatorPreviewStreams?: AndroidSimulatorPreviewStreamRegistry;
  }>,
): { mcp: McpServer; toolNames: string[] } {
  // This server is the per-session MCP bridge that a running session agent uses.
  // It must use the `session_agent` surface so action enablement + approvals can be
  // configured separately from the external MCP surface (`mcp`).
  const toolSurface = 'session_agent' as const;
  const credentials = opts?.credentials ?? null;
  const devPreviewRegistry = opts?.devPreviewRegistry ?? createSessionDevPreviewRegistry();
  const daemonDevPreviewRegister = opts?.daemonDevPreviewRegister ?? registerDaemonSessionDevPreview;
  const startAndroidSimulatorPreviewStream = opts?.startAndroidSimulatorPreviewStream ?? startAndroidScreenshotMjpegStream;
  const activeAndroidStreams = opts?.androidSimulatorPreviewStreams ?? new Map<string, AndroidScreenshotMjpegStream>();
  const isActionEnabled = createMcpActionEnablement({
    accountSettings: opts?.accountSettings ?? null,
    surface: toolSurface,
  });
  const isActionApprovalRequired = createMcpActionApprovalRequirement({
    accountSettings: opts?.accountSettings ?? null,
    surface: toolSurface,
  });
  const ctx = credentials
    ? resolveSessionEncryptionContextFromCredentials(credentials)
    : { encryptionKey: new Uint8Array(0), encryptionVariant: 'legacy' as const };

  const mcp = new McpServer({
    name: 'Happier MCP',
    version: '1.0.0',
  });

  const sessionScopedRpc = async (method: string, params: unknown) =>
    await client.rpcHandlerManager.invokeLocal(method, params);
  const sessionMetadataSnapshot = client.getMetadataSnapshot?.() ?? null;
  const rawSession = sessionMetadataSnapshot ? { metadata: sessionMetadataSnapshot } : null;
  const executionRuns = {
    start: async (request: unknown) =>
      normalizeExecutionRunRpcPayload(
        await (client.executionRuns?.start?.(request) ?? sessionScopedRpc('execution.run.start', request)),
      ),
    list: async (request: unknown) =>
      normalizeExecutionRunRpcPayload(
        await (client.executionRuns?.list?.(request) ?? sessionScopedRpc('execution.run.list', request)),
      ),
    get: async (request: unknown) =>
      normalizeExecutionRunRpcPayload(
        await (client.executionRuns?.get?.(request) ?? sessionScopedRpc('execution.run.get', request)),
      ),
    send: async (request: unknown) =>
      normalizeExecutionRunRpcPayload(
        await (client.executionRuns?.send?.(request) ?? sessionScopedRpc('execution.run.send', request)),
      ),
    stop: async (request: unknown) =>
      normalizeExecutionRunRpcPayload(
        await (client.executionRuns?.stop?.(request) ?? sessionScopedRpc('execution.run.stop', request)),
      ),
    action: async (request: unknown) =>
      normalizeExecutionRunRpcPayload(
        await (client.executionRuns?.action?.(request) ?? sessionScopedRpc('execution.run.action', request)),
      ),
    wait: async (request: unknown) =>
      normalizeExecutionRunRpcPayload(
        await (client.executionRuns?.wait?.(request) ?? sessionScopedRpc('execution.run.wait', request)),
      ),
  };

  const harness = createCliActionExecutorHarness(
    {
      token: credentials?.token ?? '',
      ...(credentials ? { credentials } : {}),
      sessionId: client.sessionId,
      ctx,
      rawSession,
    },
    {
      sessionTitleSet: async ({ sessionId, title }) => {
        const normalizedSessionId = String(sessionId ?? '').trim();
        if (!normalizedSessionId) {
          return { ok: false as const, errorCode: 'invalid_parameters' as const, error: 'invalid_parameters' as const };
        }
        const normalizedTitle = String(title ?? '').trim();
        if (!normalizedTitle) {
          return { ok: false as const, errorCode: 'invalid_parameters' as const, error: 'invalid_parameters' as const };
        }
        if (normalizedSessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }

        try {
          await Promise.resolve(client.updateMetadata((current) => ({
            ...current,
            summary: {
              text: normalizedTitle,
              updatedAt: Date.now(),
            },
          })));
        } catch (error) {
          logger.debug('[mcp] Failed to update title metadata via session-scoped bridge', {
            sessionId: normalizedSessionId,
            error,
          });
          return { ok: false as const, errorCode: 'metadata_update_failed' as const, error: 'metadata_update_failed' as const };
        }

        return { ok: true as const, sessionId: normalizedSessionId, title: normalizedTitle };
      },
      sessionDevPreviewRegister: async ({ sessionId, port, url, name, framework, rewriteUrls, healthPath }) => {
        if (sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const metadataSnapshot = client.getMetadataSnapshot?.() ?? null;
        const machineId = typeof metadataSnapshot?.machineId === 'string' ? metadataSnapshot.machineId.trim() : '';
        if (!machineId) {
          return {
            ok: false as const,
            errorCode: 'missing_machine_id' as const,
            error: 'missing_machine_id' as const,
          };
        }

        const localPreview = await devPreviewRegistry.register({
          sessionId,
          machineId,
          ...(typeof port === 'number' ? { port } : {}),
          ...(typeof url === 'string' && url.trim() ? { url: url.trim() } : {}),
          name,
          framework,
          rewriteUrls,
          healthPath,
          source: 'mcp_tool',
        });
        let preview = localPreview;
        if (daemonDevPreviewRegister) {
          try {
            const daemonResult = await daemonDevPreviewRegister({
              sessionId,
              expectedMachineId: machineId,
              ...(typeof port === 'number' ? { port } : {}),
              ...(typeof url === 'string' && url.trim() ? { url: url.trim() } : {}),
              ...(name ? { name } : {}),
              ...(framework ? { framework } : {}),
              ...(healthPath ? { healthPath } : {}),
              ...(typeof rewriteUrls === 'boolean' ? { rewriteUrls } : {}),
            });
            if ('success' in daemonResult && daemonResult.success === true) {
              preview = daemonResult.preview;
            } else {
              logger.debug('[mcp] Failed to register dev preview with daemon registry', {
                sessionId,
                machineId,
                result: daemonResult,
              });
            }
          } catch (error) {
            logger.debug('[mcp] Failed to register dev preview with daemon registry', {
              sessionId,
              machineId,
              error,
            });
          }
        }
        emitLocalServicePreviewMessage({
          preview,
          sendClaudeSessionMessage: client.sendClaudeSessionMessage.bind(client),
        });
        try {
          await Promise.resolve(client.updateMetadata((current) => (
            writeLocalServicePreviewToSessionMetadata(current, preview)
          )));
        } catch (error) {
          logger.debug('[mcp] Failed to update dev preview metadata via session-scoped bridge', {
            sessionId,
            machineId,
            error,
          });
        }
        return preview;
      },
      sessionSimulatorPreviewRegister: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const preview = buildSimulatorPreviewPayload(input);
        emitSimulatorPreviewMessage({
          preview,
          sendClaudeSessionMessage: client.sendClaudeSessionMessage.bind(client),
        });
        return preview;
      },
      sessionSimulatorPreviewAndroidStart: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const previous = activeAndroidStreams.get(input.sessionId);
        if (previous) {
          activeAndroidStreams.delete(input.sessionId);
          await previous.close().catch((error) => {
            logger.debug('[mcp] Failed to close previous Android simulator preview stream', {
              sessionId: input.sessionId,
              error,
            });
          });
        }

        const stream = await startAndroidSimulatorPreviewStream({
          host: '127.0.0.1',
          ...(typeof input.port === 'number' ? { port: input.port } : {}),
          ...(typeof input.pollMs === 'number' ? { pollIntervalMs: input.pollMs } : {}),
          ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        });
        activeAndroidStreams.set(input.sessionId, stream);

        const preview = buildSimulatorPreviewPayload({
          sessionId: input.sessionId,
          platform: 'android',
          deviceName: input.deviceName,
          ...(input.appName ? { appName: input.appName } : {}),
          streamUrl: stream.streamUrl,
          mode: 'ai_control',
          owner: 'ai',
          connectionPath: 'direct',
        });
        emitSimulatorPreviewMessage({
          preview,
          sendClaudeSessionMessage: client.sendClaudeSessionMessage.bind(client),
        });
        return preview;
      },
      executionRunStart: async (_sessionId, request) => await executionRuns.start(request),
      executionRunList: async (_sessionId, request) => await executionRuns.list(request),
      executionRunGet: async (_sessionId, request) => await executionRuns.get(request),
      executionRunSend: async (_sessionId, request) => await executionRuns.send(request),
      executionRunStop: async (_sessionId, request) => await executionRuns.stop(request),
      executionRunAction: async (_sessionId, request) => await executionRuns.action(request),
      executionRunWait: async (_sessionId, request) => await executionRuns.wait(request),

      daemonMemorySearch: async ({ query }): Promise<MemorySearchResultV1> => {
        const res = await sessionScopedRpc(RPC_METHODS.DAEMON_MEMORY_SEARCH, query);
        return MemorySearchResultV1Schema.parse(res);
      },
      daemonMemoryGetWindow: async ({ sessionId, seqFrom, seqTo }): Promise<MemoryWindowV1> => {
        const res = await sessionScopedRpc(RPC_METHODS.DAEMON_MEMORY_GET_WINDOW, { v: 1, sessionId, seqFrom, seqTo });
        return MemoryWindowV1Schema.parse(res);
      },
      daemonMemoryEnsureUpToDate: async ({ sessionId }) =>
        await sessionScopedRpc(RPC_METHODS.DAEMON_MEMORY_ENSURE_UP_TO_DATE, sessionId ? { sessionId } : {}),

      promptRegistryInstall: async (args) => {
        if (!args.installTarget) {
          return { ok: false as const, errorCode: 'invalid_request' as const, error: 'installTarget is required' };
        }

        const request = PromptRegistryInstallRequestV1Schema.parse({
          sourceId: args.sourceId,
          itemId: args.itemId,
          configuredSources: args.configuredSources ?? [],
          installTarget: args.installTarget,
        });
        const res = await sessionScopedRpc(RPC_METHODS.DAEMON_PROMPT_REGISTRY_INSTALL, request);
        return PromptRegistryInstallResponseV1Schema.parse(res);
      },

      resetGlobalVoiceAgent: async () => {},
      isActionEnabled: (id) => isActionEnabled(id),
      isActionApprovalRequired: (id) => isActionApprovalRequired(id),
    },
  );

  const executor = harness.executor;

  registerHappierMcpResources(mcp as any, {
    surface: toolSurface,
    isActionEnabled,
  });

  const actionToolBridge = createActionToolExecutorBridge({
    executor,
    isActionEnabled: (id) => {
      const spec = getActionSpec(id as any);
      return isActionSpecSurfacedOn(spec, toolSurface) && isActionEnabled(id as any);
    },
    surface: toolSurface,
  });

  const { toolNames } = registerHappierMcpBuiltInTools(mcp as any, {
    sessionId: client.sessionId,
    surface: toolSurface,
    deps: {
      changeTitle: createChangeTitleToolHandler({
        executor,
        surface: toolSurface,
        afterCommit: async ({ title }) => {
          // Keep the in-memory session metadata snapshot in sync so the UI / session agent
          // can reflect the new title immediately (without requiring a full server refresh).
          await Promise.resolve(client.updateMetadata((current) => ({
            ...current,
            summary: {
              text: title,
              updatedAt: Date.now(),
            },
          })));
        },
      }),
      startExecutionRun: createStartExecutionRunToolHandler({ executor, surface: toolSurface }),
      executeActionByToolName: actionToolBridge.executeActionByToolName,
      resolveActionOptions: (args) => actionToolBridge.resolveActionOptions(args, client.sessionId),
      isActionEnabled: actionToolBridge.isActionEnabled,
    },
  });

  return {
    mcp,
    toolNames,
  };
}
