import type { AndroidSimulatorPreviewControlRegistry } from './createAndroidSimulatorPreviewControlRegistry';
import type { IosSimulatorPreviewControlRegistry } from './createIosSimulatorPreviewControlRegistry';

type SimulatorPreviewPlatform = 'android' | 'ios';
type ControlRegistry = Pick<
  AndroidSimulatorPreviewControlRegistry,
  'acquire' | 'release' | 'sendInput' | 'reloadApp' | 'reconnectDevServices'
>;
type ClearableControlRegistry = ControlRegistry & Pick<AndroidSimulatorPreviewControlRegistry, 'clearSessionPreviews'>;

type RegistryOperation = keyof ControlRegistry;
type RegistryOperationInput<K extends RegistryOperation> = Parameters<ControlRegistry[K]>[0];
type RegistryOperationResult<K extends RegistryOperation> = Awaited<ReturnType<ControlRegistry[K]>>;

function platformKey(sessionId: string, simulatorSessionId: string): string {
  return `${sessionId}\u0000${simulatorSessionId}`;
}

function isSimulatorPreviewNotFound(result: unknown): boolean {
  return Boolean(
    result
    && typeof result === 'object'
    && (result as { ok?: unknown }).ok === false
    && (result as { errorCode?: unknown }).errorCode === 'simulator_preview_not_found',
  );
}

export function createSimulatorPreviewControlRegistryRouter(params: Readonly<{
  android: ClearableControlRegistry;
  ios: Pick<IosSimulatorPreviewControlRegistry, RegistryOperation | 'clearSessionPreviews'>;
  platforms?: Map<string, SimulatorPreviewPlatform>;
}>) {
  const platforms = params.platforms ?? new Map<string, SimulatorPreviewPlatform>();

  async function call<K extends RegistryOperation>(
    operation: K,
    input: RegistryOperationInput<K>,
  ): Promise<RegistryOperationResult<K>> {
    const key = platformKey(input.sessionId, input.simulatorSessionId);
    const platform = platforms.get(key);
    if (platform === 'ios') {
      return await params.ios[operation](input as never) as RegistryOperationResult<K>;
    }
    if (platform === 'android') {
      return await params.android[operation](input as never) as RegistryOperationResult<K>;
    }

    const androidResult = await params.android[operation](input as never) as RegistryOperationResult<K>;
    if (!isSimulatorPreviewNotFound(androidResult)) return androidResult;
    return await params.ios[operation](input as never) as RegistryOperationResult<K>;
  }

  return {
    registerPlatform(input: Readonly<{
      sessionId: string;
      simulatorSessionId: string;
      platform: SimulatorPreviewPlatform;
    }>): void {
      platforms.set(platformKey(input.sessionId, input.simulatorSessionId), input.platform);
    },
    clearSessionPreviews(input: Readonly<{
      sessionId: string;
      platform?: SimulatorPreviewPlatform;
      excludeSimulatorSessionId?: string;
    }>): void {
      if (!input.platform || input.platform === 'android') {
        params.android.clearSessionPreviews({
          sessionId: input.sessionId,
          ...(input.excludeSimulatorSessionId ? { excludeSimulatorSessionId: input.excludeSimulatorSessionId } : {}),
        });
      }
      if (!input.platform || input.platform === 'ios') {
        params.ios.clearSessionPreviews({
          sessionId: input.sessionId,
          ...(input.excludeSimulatorSessionId ? { excludeSimulatorSessionId: input.excludeSimulatorSessionId } : {}),
        });
      }
      clearSessionPlatformEntries(platforms, input);
    },
    acquire: async (input: RegistryOperationInput<'acquire'>) => await call('acquire', input),
    release: async (input: RegistryOperationInput<'release'>) => await call('release', input),
    sendInput: async (input: RegistryOperationInput<'sendInput'>) => await call('sendInput', input),
    reloadApp: async (input: RegistryOperationInput<'reloadApp'>) => await call('reloadApp', input),
    reconnectDevServices: async (input: RegistryOperationInput<'reconnectDevServices'>) =>
      await call('reconnectDevServices', input),
  };
}

function clearSessionPlatformEntries(
  platforms: Map<string, SimulatorPreviewPlatform>,
  input: Readonly<{
    sessionId: string;
    platform?: SimulatorPreviewPlatform;
    excludeSimulatorSessionId?: string;
  }>,
): void {
  const prefix = `${input.sessionId}\u0000`;
  const excludedKey = input.excludeSimulatorSessionId
    ? platformKey(input.sessionId, input.excludeSimulatorSessionId)
    : null;
  for (const [key, platform] of platforms) {
    if (key === excludedKey) continue;
    if (key.startsWith(prefix) && (!input.platform || input.platform === platform)) {
      platforms.delete(key);
    }
  }
}
