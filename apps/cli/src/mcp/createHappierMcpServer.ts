import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { HappyMcpSessionClient } from '@/mcp/startHappyServer';
import type { Metadata } from '@/api/types';
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
import { ensureAndroidSimulatorPreviewDeviceBooted } from '@/session/simulatorPreview/ensureAndroidSimulatorPreviewDeviceBooted';
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
  ensureIosSimulatorPreviewDeviceBooted,
  resolveIosSimulatorPreviewDevice,
  type IosSimulatorPreviewDevice,
} from '@/session/simulatorPreview/resolveIosSimulatorPreviewDevice';
import { resolveIosWebDriverAgentUrl } from '@/session/simulatorPreview/resolveIosWebDriverAgentUrl';
import {
  createSimulatorDeviceService,
  type SimulatorDeviceService,
} from '@/session/simulatorPreview/createSimulatorDeviceService';
import {
  createSimulatorDeviceLeaseRenewalController,
  type SimulatorDeviceLeaseRenewalController,
} from '@/session/simulatorPreview/createSimulatorDeviceLeaseRenewalController';
import { createSimulatorPreviewControlRegistryRouter } from '@/session/simulatorPreview/createSimulatorPreviewControlRegistryRouter';
import { resolveSessionEncryptionContextFromCredentials } from '@/session/transport/encryption/sessionEncryptionContext';
import {
  PromptRegistryInstallRequestV1Schema,
  PromptRegistryInstallResponseV1Schema,
  type AccountSettings,
  type BackendTargetRefV1,
  getActionSpec,
  isActionSpecSurfacedOn,
  removeLocalServicePreviewFromSessionMetadata,
  writeLocalServicePreviewToSessionMetadata,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { MemorySearchResultV1Schema, MemoryWindowV1Schema, type MemorySearchResultV1, type MemoryWindowV1 } from '@happier-dev/protocol';
import {
  createMcpActionApprovalRequirement,
  createMcpActionEnablement,
  createMcpActionSettingsProvider,
} from '@/mcp/server/createMcpActionEnablement';
import {
  closeDaemonSessionDevPreview,
  listDaemonSessionDevPreviews,
  registerDaemonSessionDevPreview,
  type DaemonDevPreviewCloseRequest,
  type DaemonDevPreviewCloseResult,
  type DaemonDevPreviewListRequest,
  type DaemonDevPreviewListResult,
  type DaemonDevPreviewRegisterRequest,
  type DaemonDevPreviewRegisterResult,
} from '@/daemon/controlClient';

const SIMULATOR_DEVICE_WRITER_LEASE_RENEW_INTERVAL_MS = 20_000;

export type AndroidSimulatorPreviewStreamRegistry = Map<string, AndroidScreenshotMjpegStream>;
export type IosSimulatorPreviewStreamRegistry = Map<string, IosScreenshotMjpegStream>;

function resolveLiveClientPermissionMode(
  client: HappyMcpSessionClient,
  metadataSnapshot?: Metadata | null,
): string | null {
  const mode = client.getPermissionMode?.()
    ?? metadataSnapshot?.permissionMode
    ?? null;
  return typeof mode === 'string' && mode.trim().length > 0 ? mode.trim() : null;
}

function resolveLiveClientBackendTarget(client: HappyMcpSessionClient): BackendTargetRefV1 | null {
  return client.getBackendTarget?.() ?? null;
}

function resolveLiveClientLocation(client: HappyMcpSessionClient): Readonly<{
  path?: string | null;
  host?: string | null;
  machineId?: string | null;
}> | null {
  return client.getCurrentSessionLocation?.() ?? null;
}

export function createHappierMcpServer(
  client: HappyMcpSessionClient,
  opts?: Readonly<{
    credentials?: Credentials | null;
    accountSettings?: AccountSettings | null;
    getAccountSettings?: (() => AccountSettings | null) | null;
    devPreviewRegistry?: SessionDevPreviewRegistry | null;
    daemonDevPreviewRegister?: ((request: DaemonDevPreviewRegisterRequest) => Promise<DaemonDevPreviewRegisterResult>) | null;
    daemonDevPreviewList?: ((request: DaemonDevPreviewListRequest) => Promise<DaemonDevPreviewListResult>) | null;
    daemonDevPreviewClose?: ((request: DaemonDevPreviewCloseRequest) => Promise<DaemonDevPreviewCloseResult>) | null;
    startAndroidSimulatorPreviewStream?: typeof startAndroidScreenshotMjpegStream;
    ensureAndroidSimulatorPreviewDeviceBooted?: typeof ensureAndroidSimulatorPreviewDeviceBooted;
    startIosSimulatorPreviewStream?: typeof startIosScreenshotMjpegStream;
    resolveAndroidSimulatorPreviewGeometry?: typeof resolveAndroidSimulatorPreviewGeometry;
    androidSimulatorPreviewStreams?: AndroidSimulatorPreviewStreamRegistry;
    iosSimulatorPreviewStreams?: IosSimulatorPreviewStreamRegistry;
    androidSimulatorPreviewControlRegistry?: AndroidSimulatorPreviewControlRegistry;
    iosSimulatorPreviewControlRegistry?: IosSimulatorPreviewControlRegistry;
    simulatorPreviewControlPlatforms?: Map<string, 'android' | 'ios'>;
    simulatorDeviceService?: SimulatorDeviceService;
    simulatorDeviceLeaseRenewals?: SimulatorDeviceLeaseRenewalController;
    resolveIosSimulatorPreviewDevice?: typeof resolveIosSimulatorPreviewDevice;
    ensureIosSimulatorPreviewDeviceBooted?: typeof ensureIosSimulatorPreviewDeviceBooted;
    resolveIosWebDriverAgentUrl?: typeof resolveIosWebDriverAgentUrl;
  }>,
): { mcp: McpServer; toolNames: string[] } {
  // This server is the per-session MCP bridge that a running session agent uses.
  // It must use the `session_agent` surface so action enablement + approvals can be
  // configured separately from the external MCP surface (`mcp`).
  const toolSurface = 'session_agent' as const;
  const credentials = opts?.credentials ?? null;
  const devPreviewRegistry = opts?.devPreviewRegistry ?? createSessionDevPreviewRegistry();
  const daemonDevPreviewRegister = opts?.daemonDevPreviewRegister ?? registerDaemonSessionDevPreview;
  const daemonDevPreviewList = opts?.daemonDevPreviewList ?? listDaemonSessionDevPreviews;
  const daemonDevPreviewClose = opts?.daemonDevPreviewClose ?? closeDaemonSessionDevPreview;
  const startAndroidSimulatorPreviewStream = opts?.startAndroidSimulatorPreviewStream ?? startAndroidScreenshotMjpegStream;
  const ensureAndroidDeviceBooted = opts?.ensureAndroidSimulatorPreviewDeviceBooted ?? ensureAndroidSimulatorPreviewDeviceBooted;
  const startIosSimulatorPreviewStream = opts?.startIosSimulatorPreviewStream ?? startIosScreenshotMjpegStream;
  const resolveAndroidGeometry = opts?.resolveAndroidSimulatorPreviewGeometry ?? resolveAndroidSimulatorPreviewGeometry;
  const resolveIosDevice = opts?.resolveIosSimulatorPreviewDevice ?? resolveIosSimulatorPreviewDevice;
  const ensureIosDeviceBooted = opts?.ensureIosSimulatorPreviewDeviceBooted ?? ensureIosSimulatorPreviewDeviceBooted;
  const resolveIosWdaUrl = opts?.resolveIosWebDriverAgentUrl ?? resolveIosWebDriverAgentUrl;
  const activeAndroidStreams = opts?.androidSimulatorPreviewStreams ?? new Map<string, AndroidScreenshotMjpegStream>();
  const activeIosStreams = opts?.iosSimulatorPreviewStreams ?? new Map<string, IosScreenshotMjpegStream>();
  const androidSimulatorPreviewControlRegistry = opts?.androidSimulatorPreviewControlRegistry
    ?? createAndroidSimulatorPreviewControlRegistry();
  const iosSimulatorPreviewControlRegistry = opts?.iosSimulatorPreviewControlRegistry
    ?? createIosSimulatorPreviewControlRegistry();
  const simulatorPreviewControlPlatforms = opts?.simulatorPreviewControlPlatforms
    ?? new Map<string, 'android' | 'ios'>();
  const simulatorDeviceService = opts?.simulatorDeviceService ?? createSimulatorDeviceService();
  const hasInjectedSimulatorDeviceService = Boolean(opts?.simulatorDeviceService);
  const actionSettingsProvider = createMcpActionSettingsProvider({
    accountSettings: opts?.accountSettings ?? null,
    getAccountSettings: opts?.getAccountSettings ?? null,
  });
  const readActionsSettings = () => actionSettingsProvider.getActionsSettings();
  const isActionEnabled = createMcpActionEnablement({
    actionSettingsProvider,
    surface: toolSurface,
  });
  const isActionApprovalRequired = createMcpActionApprovalRequirement({
    actionSettingsProvider,
    surface: toolSurface,
  });
  const ctx = credentials
    ? resolveSessionEncryptionContextFromCredentials(credentials)
    : { encryptionKey: new Uint8Array(0), encryptionVariant: 'legacy' as const };

  const simulatorDeviceLeaseRenewals = opts?.simulatorDeviceLeaseRenewals ?? createSimulatorDeviceLeaseRenewalController({
    simulatorDeviceService,
    renewIntervalMs: SIMULATOR_DEVICE_WRITER_LEASE_RENEW_INTERVAL_MS,
    onRenewalFailed: (failure) => {
      logger.debug('[mcp] Failed to renew simulator device writer lease', failure);
    },
  });
  const simulatorPreviewControlRegistry = createSimulatorPreviewControlRegistryRouter({
    android: androidSimulatorPreviewControlRegistry,
    ios: iosSimulatorPreviewControlRegistry,
    platforms: simulatorPreviewControlPlatforms,
  });

  const mcp = new McpServer({
    name: 'Happier MCP',
    version: '1.0.0',
  });

  const sessionScopedRpc = async (method: string, params: unknown) =>
    await client.rpcHandlerManager.invokeLocal(method, params);
  const sessionMetadataSnapshot = client.getMetadataSnapshot?.() ?? null;
  const sessionLocation = resolveLiveClientLocation(client);
  const rawSession = sessionMetadataSnapshot || sessionLocation
    ? {
        ...(sessionMetadataSnapshot ? { metadata: sessionMetadataSnapshot } : {}),
        ...(typeof sessionLocation?.path === 'string' ? { path: sessionLocation.path } : {}),
        ...(typeof sessionLocation?.host === 'string' ? { host: sessionLocation.host } : {}),
        ...(typeof sessionLocation?.machineId === 'string' ? { machineId: sessionLocation.machineId } : {}),
      }
    : null;
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
      getCallerPermissionMode: () => resolveLiveClientPermissionMode(client, sessionMetadataSnapshot),
      getCurrentSessionBackendTarget: () => resolveLiveClientBackendTarget(client),
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
      sessionDevPreviewList: async ({ sessionId }) => {
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
        if (daemonDevPreviewList) {
          try {
            const daemonResult = await daemonDevPreviewList({
              sessionId,
              expectedMachineId: machineId,
            });
            if ('success' in daemonResult && daemonResult.success === true) {
              return {
                ok: true as const,
                previews: daemonResult.previews,
              };
            }
            logger.debug('[mcp] Failed to list dev previews from daemon registry', {
              sessionId,
              machineId,
              result: daemonResult,
            });
          } catch (error) {
            logger.debug('[mcp] Failed to list dev previews from daemon registry', {
              sessionId,
              machineId,
              error,
            });
          }
        }
        return {
          ok: true as const,
          previews: devPreviewRegistry.list({ sessionId, machineId }),
        };
      },
      sessionDevPreviewClose: async ({ sessionId, resourceId }) => {
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
        let closed = devPreviewRegistry.close({ sessionId, machineId, resourceId });
        if (daemonDevPreviewClose) {
          try {
            const daemonResult = await daemonDevPreviewClose({
              sessionId,
              expectedMachineId: machineId,
              resourceId,
            });
            if ('success' in daemonResult && daemonResult.success === true) {
              closed = {
                closed: daemonResult.closed,
                preview: daemonResult.preview,
              };
            } else {
              logger.debug('[mcp] Failed to close dev preview in daemon registry', {
                sessionId,
                machineId,
                resourceId,
                result: daemonResult,
              });
            }
          } catch (error) {
            logger.debug('[mcp] Failed to close dev preview in daemon registry', {
              sessionId,
              machineId,
              resourceId,
              error,
            });
          }
        }
        if (closed.closed) {
          try {
            await Promise.resolve(client.updateMetadata((current) => (
              removeLocalServicePreviewFromSessionMetadata(current, resourceId)
            )));
          } catch (error) {
            logger.debug('[mcp] Failed to remove dev preview metadata via session-scoped bridge', {
              sessionId,
              machineId,
              resourceId,
              error,
            });
          }
        }
        return {
          ok: true as const,
          closed: closed.closed,
          preview: closed.preview,
        };
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
      sessionSimulatorPreviewDevicesList: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        return await simulatorDeviceService.listDevices({
          ...(input.platform ? { platform: input.platform } : {}),
        });
      },
      sessionSimulatorPreviewAndroidStart: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const simulatorSessionId = `sim_${randomUUID()}`;
        const useDeviceService = hasInjectedSimulatorDeviceService || Boolean(input.deviceRef) || input.selection === 'auto';
        const reservation = useDeviceService
          ? await simulatorDeviceService.reservePreview({
              sessionId: input.sessionId,
              simulatorSessionId,
              platform: 'android',
              selection: input.selection ?? 'auto',
              ...(input.deviceRef ? { deviceRef: input.deviceRef } : {}),
              ...(input.deviceId ? { deviceId: input.deviceId } : {}),
              owner: 'ai',
            })
          : null;
        if (reservation && !reservation.ok) {
          return reservation;
        }
        try {
          let deviceId = reservation?.ok ? reservation.deviceId : input.deviceId;
          const deviceName = reservation?.ok ? reservation.deviceDisplayName : input.deviceName;
          if (reservation?.ok && reservation.deviceState === 'available') {
            deviceId = (await ensureAndroidDeviceBooted({ deviceId: reservation.deviceId })).deviceId;
          }
          const previous = activeAndroidStreams.get(input.sessionId);
          if (previous) {
            simulatorDeviceLeaseRenewals.clear(input.sessionId, 'android');
            activeAndroidStreams.delete(input.sessionId);
            simulatorDeviceService.releaseSessionPreviews({
              sessionId: input.sessionId,
              platform: 'android',
              excludeSimulatorSessionId: simulatorSessionId,
            });
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
            ...(deviceId ? { deviceId } : {}),
          });
          const geometry: AndroidSimulatorPreviewGeometry = await resolveAndroidGeometry({
            ...(deviceId ? { deviceId } : {}),
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
            simulatorSessionId,
            platform: 'android',
            deviceName,
            ...(input.appName ? { appName: input.appName } : {}),
            streamUrl: stream.streamUrl,
            mode: 'ai_control',
            owner: 'ai',
            connectionPath: relay ? 'relay' : 'direct',
            ...(reservation?.ok ? { controlCapability: reservation.controlCapability } : {}),
            ...(reservation?.ok && reservation.controlCapability === 'readonly' ? { controlUnavailableReason: reservation.controlUnavailableReason } : {}),
            ...(reservation?.ok ? { deviceRef: reservation.deviceRef, deviceDisplayName: reservation.deviceDisplayName } : {}),
            ...(relay ? { relay } : {}),
            ...(input.nativeDevSessionId ? { nativeDevSessionId: input.nativeDevSessionId } : {}),
            ...(input.devServices ? { devServices: input.devServices } : {}),
          });
          emitSimulatorPreviewMessage({
            preview,
            sendClaudeSessionMessage: client.sendClaudeSessionMessage.bind(client),
          });
          simulatorPreviewControlRegistry.clearSessionPreviews({
            sessionId: input.sessionId,
            platform: 'android',
            excludeSimulatorSessionId: preview.simulatorSessionId,
          });
          if (reservation?.controlCapability !== 'readonly') {
            androidSimulatorPreviewControlRegistry.registerAndroidPreview({
              sessionId: input.sessionId,
              simulatorSessionId: preview.simulatorSessionId,
              ...(deviceId ? { deviceId } : {}),
              deviceWidth: geometry.deviceWidth,
              deviceHeight: geometry.deviceHeight,
              ...(input.devServices ? { devServices: input.devServices } : {}),
            });
          }
          simulatorPreviewControlPlatforms.set(`${input.sessionId}\u0000${preview.simulatorSessionId}`, 'android');
          simulatorDeviceLeaseRenewals.start({
            sessionId: input.sessionId,
            simulatorSessionId: preview.simulatorSessionId,
            platform: 'android',
            writable: reservation?.ok === true && reservation.controlCapability === 'writable',
          });
          return preview;
        } catch (error) {
          if (reservation?.ok) {
            simulatorDeviceService.releasePreview({ sessionId: input.sessionId, simulatorSessionId });
          }
          throw error;
        }
      },
      sessionSimulatorPreviewIosStart: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const simulatorSessionId = `sim_${randomUUID()}`;
        const useDeviceService = hasInjectedSimulatorDeviceService || Boolean(input.deviceRef) || input.selection === 'auto';
        const reservation = useDeviceService
          ? await simulatorDeviceService.reservePreview({
              sessionId: input.sessionId,
              simulatorSessionId,
              platform: 'ios',
              selection: input.selection ?? 'auto',
              ...(input.deviceRef ? { deviceRef: input.deviceRef } : {}),
              ...(input.deviceId ? { deviceId: input.deviceId } : {}),
              owner: 'ai',
            })
          : null;
        if (reservation && !reservation.ok) {
          return reservation;
        }
        try {
          let resolvedDevice: IosSimulatorPreviewDevice | null = null;
          if (!input.deviceId && !reservation) {
            resolvedDevice = await resolveIosDevice();
          }
          const deviceId = reservation?.ok ? reservation.deviceId : input.deviceId || resolvedDevice?.deviceId;
          const deviceName = reservation?.ok
            ? reservation.deviceDisplayName
            : input.deviceName !== 'iOS Simulator'
              ? input.deviceName
              : resolvedDevice?.deviceName ?? input.deviceName;
          if (reservation?.ok && reservation.deviceState === 'available') {
            await ensureIosDeviceBooted({ deviceId: reservation.deviceId });
          }
          const wdaUrl = input.wdaUrl || await resolveIosWdaUrl();
          const previous = activeIosStreams.get(input.sessionId);
          if (previous) {
            simulatorDeviceLeaseRenewals.clear(input.sessionId, 'ios');
            activeIosStreams.delete(input.sessionId);
            simulatorDeviceService.releaseSessionPreviews({
              sessionId: input.sessionId,
              platform: 'ios',
              excludeSimulatorSessionId: simulatorSessionId,
            });
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
            simulatorSessionId,
            platform: 'ios',
            deviceName,
            ...(input.appName ? { appName: input.appName } : {}),
            streamUrl: stream.streamUrl,
            mode: 'ai_control',
            owner: 'ai',
            connectionPath: relay ? 'relay' : 'direct',
            ...(reservation?.ok ? { controlCapability: reservation.controlCapability } : {}),
            ...(reservation?.ok && reservation.controlCapability === 'readonly' ? { controlUnavailableReason: reservation.controlUnavailableReason } : {}),
            ...(reservation?.ok ? { deviceRef: reservation.deviceRef, deviceDisplayName: reservation.deviceDisplayName } : {}),
            ...(relay ? { relay } : {}),
            ...(input.nativeDevSessionId ? { nativeDevSessionId: input.nativeDevSessionId } : {}),
            ...(input.devServices ? { devServices: input.devServices } : {}),
          });
          emitSimulatorPreviewMessage({
            preview,
            sendClaudeSessionMessage: client.sendClaudeSessionMessage.bind(client),
          });
          simulatorPreviewControlRegistry.clearSessionPreviews({
            sessionId: input.sessionId,
            platform: 'ios',
            excludeSimulatorSessionId: preview.simulatorSessionId,
          });
          if (reservation?.controlCapability !== 'readonly') {
            iosSimulatorPreviewControlRegistry.registerIosPreview({
              sessionId: input.sessionId,
              simulatorSessionId: preview.simulatorSessionId,
              ...(deviceId ? { deviceId } : {}),
              wdaUrl,
            });
          }
          simulatorPreviewControlPlatforms.set(`${input.sessionId}\u0000${preview.simulatorSessionId}`, 'ios');
          simulatorDeviceLeaseRenewals.start({
            sessionId: input.sessionId,
            simulatorSessionId: preview.simulatorSessionId,
            platform: 'ios',
            writable: reservation?.ok === true && reservation.controlCapability === 'writable',
          });
          return preview;
        } catch (error) {
          if (reservation?.ok) {
            simulatorDeviceService.releasePreview({ sessionId: input.sessionId, simulatorSessionId });
          }
          throw error;
        }
      },
      sessionSimulatorPreviewControlAcquire: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const writable = simulatorDeviceService.assertPreviewWritable(input);
        if (!writable.ok && writable.errorCode !== 'simulator_preview_not_found') return writable;
        return await simulatorPreviewControlRegistry.acquire(input);
      },
      sessionSimulatorPreviewControlRelease: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        return await simulatorPreviewControlRegistry.release(input);
      },
      sessionSimulatorPreviewInputSend: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const writable = simulatorDeviceService.assertPreviewWritable(input);
        if (!writable.ok && writable.errorCode !== 'simulator_preview_not_found') return writable;
        return await simulatorPreviewControlRegistry.sendInput(input);
      },
      sessionSimulatorPreviewAppReload: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const writable = simulatorDeviceService.assertPreviewWritable(input);
        if (!writable.ok && writable.errorCode !== 'simulator_preview_not_found') return writable;
        return await simulatorPreviewControlRegistry.reloadApp(input);
      },
      sessionSimulatorPreviewDevServicesReconnect: async (input) => {
        if (input.sessionId !== client.sessionId) {
          return { ok: false as const, errorCode: 'not_authenticated' as const, error: 'not_authenticated' as const };
        }
        const writable = simulatorDeviceService.assertPreviewWritable(input);
        if (!writable.ok && writable.errorCode !== 'simulator_preview_not_found') return writable;
        return await simulatorPreviewControlRegistry.reconnectDevServices(input);
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
    actionsSettings: readActionsSettings(),
    getActionsSettings: readActionsSettings,
    resolveCallerPermissionMode: () => resolveLiveClientPermissionMode(client, sessionMetadataSnapshot),
  });

  const { toolNames } = registerHappierMcpBuiltInTools(mcp as any, {
    sessionId: client.sessionId,
    surface: toolSurface,
    actionsSettings: readActionsSettings(),
    getActionsSettings: readActionsSettings,
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
