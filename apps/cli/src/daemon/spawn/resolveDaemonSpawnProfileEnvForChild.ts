import type { SpawnSessionErrorCode } from '@/rpc/handlers/registerSessionHandlers';
import { SPAWN_SESSION_ERROR_CODES } from '@/rpc/handlers/registerSessionHandlers';
import type { DaemonSpawnHooks } from '@/daemon/spawnHooks';

export type ResolveDaemonSpawnProfileEnvForChildResult =
  | Readonly<{ ok: true; env: Record<string, string> }>
  | Readonly<{
    ok: false;
    errorCode: SpawnSessionErrorCode;
    errorMessage: string;
    profileId: string;
    expectedDir: string;
  }>;

export function resolveDaemonSpawnProfileEnvForChild(params: Readonly<{
  daemonSpawnHooks: DaemonSpawnHooks | null;
  profileId: string | null | undefined;
  processEnv: NodeJS.ProcessEnv;
  activeServerDir: string;
}>): ResolveDaemonSpawnProfileEnvForChildResult {
  const resolved = params.daemonSpawnHooks?.resolveProfileEnvForChild?.({
    profileId: params.profileId,
    env: params.processEnv,
    activeServerDir: params.activeServerDir,
  });

  if (!resolved) {
    return { ok: true, env: {} };
  }
  if (resolved.ok) {
    return { ok: true, env: resolved.env };
  }

  return {
    ok: false,
    errorCode: SPAWN_SESSION_ERROR_CODES.PROFILE_NOT_PROVISIONED,
    errorMessage: `Profile ${resolved.profileId} is not provisioned for this provider on this machine.`,
    profileId: resolved.profileId,
    expectedDir: resolved.expectedDir,
  };
}
