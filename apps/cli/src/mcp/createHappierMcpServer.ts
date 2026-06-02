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
import {
  startIosScreenshotMjpegStream,
  type IosScreenshotMjpegStream,
} from '@/session/simulatorPreview/startIosScreenshotMjpegStream';
import {
  resolveAndroidSimulatorPreviewGeometry,
  type AndroidSimulatorPreviewGeometry,
} from '@/session/simulatorPreview/resolveAndroidSimulatorPreviewGeometry';
import {
  createAndroidSimulatorPreviewControlRegistry,
  type AndroidSimulatorPreviewControlRegistry,
} from '@/session/simulatorPreview/createAndroidSimulatorPreviewControlRegistry';
import {
  createIosSimulatorPreviewControlRegistry,
  type IosSimulatorPreviewControlRegistry,
} from '@/session/simulatorPreview/createIosSimulatorPreviewControlRegistry';
import {
  resolveIosSimulatorPreviewDevice,
  type IosSimulatorPreviewDevice,
} from '@/session/simulatorPreview/resolveIosSimulatorPreviewDevice';
import { resolveIosWebDriverAgentUrl } from '@/session/simulatorPreview/resolveIosWebDriverAgentUrl';
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
export type IosSimulatorPreviewStreamRegistry = Map<string, IosScreenshotMjpegStream>;

export function createHappierMcpServer(
  client: HappyMcpSessionClient,
  opts?: Readonly<{
    credentials?: Credentials | null;
    accountSettings?: AccountSettings | null;
    devPreviewRegistry?: SessionDevPreviewRegistry | null;
    daemonDevPreviewRegister?: ((request: DaemonDevPreviewRegisterRequest) => Promise<DaemonDevPreviewRegisterResult>) | null;
    startAndroidSimulatorPreviewStream?: typeof startAndroidScreenshotMjpegStream;
    startIosSimulatorPreviewStream?: typeof startIosScreenshotMjpegStream;
    resolveAndroidSimulatorPreviewGeometry?: typeof resolveAndroidSimulatorPreviewGeometry;
    androidSimulatorPreviewStreams?: AndroidSimulatorPreviewStreamRegistry;
    iosSimulatorPreviewStreams?: IosSimulatorPreviewStreamRegistry;
    androidSimulatorPreviewControlRegistry?: AndroidSimulatorPreviewControlRegistry;
    iosSimulatorPreviewControlRegistry?: IosSimulatorPreviewControlRegistry;
    simulatorPreviewControlPlatforms?: Map<string, 'android' | 'ios'>;
    resolveIosSimulatorPreviewDevice?: typeof resolveIosSimulatorPreviewDevice;
    resolveIosWebDriverAgentUrl?: typeof resolveIosWebDriverAgentUrl;
  }>,
): { mcp: McpServer; toolNames: string[] } {
  // This server is the per-session MCP bridge that a running session agent uses.
  // It must use the `session_agent` surface so action enablement + approvals can be
  // configured separately from the external MCP surface (`mcp`).
  const toolSurface = 'session_agent' as const;
  const credentials = opts?.credentials ?? null;
  const actionsSettings = opts?.accountSettings?.actionsSettingsV1 ?? null;
  const devPreviewRegistry = opts?.devPreviewRegistry ?? createSessionDevPreviewRegistry();
  const daemonDevPreviewRegister = opts?.daemonDevPreviewRegister ?? registerDaemonSessionDevPreview;
  const startAndroidSimulatorPreviewStream = opts?.startAndroidSimulatorPreviewStream ?? startAndroidScreenshotMjpegStream;
  const startIosSimulatorPreviewStream = opts?.startIosSimulatorPreviewStream ?? startIosScreenshotMjpegStream;
  const resolveAndroidGeometry = opts?.resolveAndroidSimulatorPreviewGeometry ?? resolveAndroidSimulatorPreviewGeometry;
  const resolveIosDevice = opts?.resolveIosSimulatorPreviewDevice ?? resolveIosSimulatorPreviewDevice;
  const resolveIosWdaUrl = opts?.resolveIosWebDriverAgentUrl ?? resolveIosWebDriverAgentUrl;
  const activeAndroidStreams = opts?.androidSimulatorPreviewStreams ?? new Map<string, AndroidScreenshotMjpegStream>();
  const activeIosStreams = opts?.iosSimulatorPreviewStreams ?? new Map<string, IosScreenshotMjpegStream>();
  const androidSimulatorPreviewControlRegistry = opts?.androidSimulatorPreviewControlRegistry
    ?? createAndroidSimulatorPreviewControlRegistry();
  const iosSimulatorPreviewControlRegistry = opts?.iosSimulatorPreviewControlRegistry
    ?? createIosSimulatorPreviewControlRegistry();
  const simulatorPreviewControlPlatforms = opts?.simulatorPreviewControlPlatforms
    ?? new Map<string, 'android' | 'ios'>();
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
        const geometry: AndroidSimulatorPreviewGeometry = await resolveAndroidGeometry({
          ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        });
        activeAndroidStreams.set(input.sessionId, stream);

        const metadataSnapshot = client.getMetadataSnapshot?.() ?? null;
        const machineId = typeof metadataSnapshot?.machineId === 'string' ? metadataSnapshot.machineId.trim() : '';
        let relay: { machineId: string; routeKey: string; streamPath: string } | undefined;
        if (machineId && daemonDevPreviewRegister) {
          try {
            const daemonResult = await daemonDevPreviewRegister({
              sessionId: input.sessionId,
              expectedMachineId: machineId,
              port: stream.port,
              name: `${input.deviceName} simulator`,
              healthPath: '/frame.jpg',
              rewriteUrls: false,
            });
            if ('success' in daemonResult && daemonResult.success === true) {
              relay = {
                machineId: daemonResult.preview.machineId,
                routeKey: daemonResult.preview.preview.routeKey,
                streamPath: '/stream.mjpeg',
              };
            } else {
              logger.debug('[mcp] Failed to register Android simulator preview stream with daemon registry', {
                sessionId: input.sessionId,
                machineId,
                result: daemonResult,
              });
            }
          } catch (error) {
            logger.debug('[mcp] Failed to register Android simulator preview stream with daemon registry', {
              sessionId: input.sessionId,
              machineId,
              error,
            });
          }
        }

        const preview = buildSimulatorPreviewPayload({
          sessionId: input.sessionId,
          platform: 'android',
          deviceName: input.deviceName,
          ...(input.appName ? { appName: input.appName } : {}),
          streamUrl: stream.streamUrl,
          mode: 'ai_control',
          owner: 'ai',
          connectionPath: relay ? 'relay' : 'direct',
          ...(relay ? { relay } : {}),
          ...(input.nativeDevSessionId ? { nativeDevSessionId: input.nativeDevSessionId } : {}),
          ...(input.devServices ? { devServices: input.devServices } : {}),
        });
        emitSimulatorPreviewMessage({
          preview,
          sendClaudeSessionMessage: client.sendClaudeSessionMessage.bind(client),
        });
        androidSimulatorPreviewControlRegistry.registerAndroidPreview({
          sessionId: input.sessionId,
          simulatorSessionId: preview.simulatorSessionId,
          ...(input.deviceId ? { deviceId: input.deviceId } : {}),
          deviceWidth: geometry.deviceWidth,
          deviceHeight: geometry.deviceHeight,
          ...(input.devServices ? { devServices: input.devServices } : {}),
        });
        simulatorPreviewControlPlatforms.set(`${input.sessionId}\u0000${preview.simulatorSessionId}`, 'android');
        return preview;
      },
      sessionSimulatorPreviewIosStart: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        let resolvedDevice: IosSimulatorPreviewDevice | null = null;
        if (!input.deviceId) {
          resolvedDevice = await resolveIosDevice();
        }
        const deviceId = input.deviceId || resolvedDevice?.deviceId;
        const deviceName = input.deviceName !== 'iOS Simulator'
          ? input.deviceName
          : resolvedDevice?.deviceName ?? input.deviceName;
        const wdaUrl = input.wdaUrl || await resolveIosWdaUrl();
        const previous = activeIosStreams.get(input.sessionId);
        if (previous) {
          activeIosStreams.delete(input.sessionId);
          await previous.close().catch((error) => {
            logger.debug('[mcp] Failed to close previous iOS simulator preview stream', {
              sessionId: input.sessionId,
              error,
            });
          });
        }

        const stream = await startIosSimulatorPreviewStream({
          host: '127.0.0.1',
          ...(typeof input.port === 'number' ? { port: input.port } : {}),
          ...(typeof input.pollMs === 'number' ? { pollIntervalMs: input.pollMs } : {}),
          ...(deviceId ? { deviceId } : {}),
        });
        activeIosStreams.set(input.sessionId, stream);

        const metadataSnapshot = client.getMetadataSnapshot?.() ?? null;
        const machineId = typeof metadataSnapshot?.machineId === 'string' ? metadataSnapshot.machineId.trim() : '';
        let relay: { machineId: string; routeKey: string; streamPath: string } | undefined;
        if (machineId && daemonDevPreviewRegister) {
          try {
            const daemonResult = await daemonDevPreviewRegister({
              sessionId: input.sessionId,
              expectedMachineId: machineId,
              port: stream.port,
              name: `${deviceName} simulator`,
              healthPath: '/frame.jpg',
              rewriteUrls: false,
            });
            if ('success' in daemonResult && daemonResult.success === true) {
              relay = {
                machineId: daemonResult.preview.machineId,
                routeKey: daemonResult.preview.preview.routeKey,
                streamPath: '/stream.mjpeg',
              };
            } else {
              logger.debug('[mcp] Failed to register iOS simulator preview stream with daemon registry', {
                sessionId: input.sessionId,
                machineId,
                result: daemonResult,
              });
            }
          } catch (error) {
            logger.debug('[mcp] Failed to register iOS simulator preview stream with daemon registry', {
              sessionId: input.sessionId,
              machineId,
              error,
            });
          }
        }

        const preview = buildSimulatorPreviewPayload({
          sessionId: input.sessionId,
          platform: 'ios',
          deviceName,
          ...(input.appName ? { appName: input.appName } : {}),
          streamUrl: stream.streamUrl,
          mode: 'ai_control',
          owner: 'ai',
          connectionPath: relay ? 'relay' : 'direct',
          ...(relay ? { relay } : {}),
          ...(input.nativeDevSessionId ? { nativeDevSessionId: input.nativeDevSessionId } : {}),
          ...(input.devServices ? { devServices: input.devServices } : {}),
        });
        emitSimulatorPreviewMessage({
          preview,
          sendClaudeSessionMessage: client.sendClaudeSessionMessage.bind(client),
        });
        iosSimulatorPreviewControlRegistry.registerIosPreview({
          sessionId: input.sessionId,
          simulatorSessionId: preview.simulatorSessionId,
          ...(deviceId ? { deviceId } : {}),
          wdaUrl,
        });
        simulatorPreviewControlPlatforms.set(`${input.sessionId}\u0000${preview.simulatorSessionId}`, 'ios');
        return preview;
      },
      sessionSimulatorPreviewControlAcquire: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const platform = simulatorPreviewControlPlatforms.get(`${input.sessionId}\u0000${input.simulatorSessionId}`) ?? 'android';
        return platform === 'ios'
          ? await iosSimulatorPreviewControlRegistry.acquire(input)
          : await androidSimulatorPreviewControlRegistry.acquire(input);
      },
      sessionSimulatorPreviewControlRelease: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const platform = simulatorPreviewControlPlatforms.get(`${input.sessionId}\u0000${input.simulatorSessionId}`) ?? 'android';
        return platform === 'ios'
          ? await iosSimulatorPreviewControlRegistry.release(input)
          : await androidSimulatorPreviewControlRegistry.release(input);
      },
      sessionSimulatorPreviewInputSend: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const platform = simulatorPreviewControlPlatforms.get(`${input.sessionId}\u0000${input.simulatorSessionId}`) ?? 'android';
        return platform === 'ios'
          ? await iosSimulatorPreviewControlRegistry.sendInput(input)
          : await androidSimulatorPreviewControlRegistry.sendInput(input);
      },
      sessionSimulatorPreviewAppReload: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const platform = simulatorPreviewControlPlatforms.get(`${input.sessionId}\u0000${input.simulatorSessionId}`) ?? 'android';
        return platform === 'ios'
          ? await iosSimulatorPreviewControlRegistry.reloadApp(input)
          : await androidSimulatorPreviewControlRegistry.reloadApp(input);
      },
      sessionSimulatorPreviewDevServicesReconnect: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const platform = simulatorPreviewControlPlatforms.get(`${input.sessionId}\u0000${input.simulatorSessionId}`) ?? 'android';
        return platform === 'ios'
          ? await iosSimulatorPreviewControlRegistry.reconnectDevServices(input)
          : await androidSimulatorPreviewControlRegistry.reconnectDevServices(input);
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
    actionsSettings,
  });

  const { toolNames } = registerHappierMcpBuiltInTools(mcp as any, {
    sessionId: client.sessionId,
    surface: toolSurface,
    actionsSettings,
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
