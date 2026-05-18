import type { CodexBackendMode } from '@happier-dev/agents';
import type { AgentRuntimeDescriptorV1 } from '@happier-dev/protocol';

import { resolveCanonicalCodexBackendMode } from '@/rpc/handlers/codexBackendMode';

export type DaemonSpawnRuntimeSelection = Readonly<{
  experimentalCodexAcp?: boolean;
  codexBackendMode?: CodexBackendMode;
  agentRuntimeDescriptorV1?: AgentRuntimeDescriptorV1;
}>;

export function resolveDaemonSpawnRuntimeCodexBackendMode(selection: DaemonSpawnRuntimeSelection): CodexBackendMode | undefined {
  return resolveCanonicalCodexBackendMode(selection);
}

export type DaemonSpawnValidationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; errorMessage: string; reasonCode?: string }>;

export type DaemonSpawnProfileEnvParams = Readonly<{
  profileId: string | null | undefined;
  env: NodeJS.ProcessEnv;
  activeServerDir: string;
}>;

export type DaemonSpawnProfileEnvResult =
  | Readonly<{ ok: true; env: Record<string, string> }>
  | Readonly<{
    ok: false;
    reason: 'profile_not_provisioned';
    profileId: string;
    expectedDir: string;
  }>;

export type DaemonSpawnHooks = Readonly<{
  validateSpawn?: (params: DaemonSpawnRuntimeSelection) => Promise<DaemonSpawnValidationResult>;
  buildExtraEnvForChild?: (params: DaemonSpawnRuntimeSelection) => Record<string, string>;
  resolveProfileEnvForChild?: (params: DaemonSpawnProfileEnvParams) => DaemonSpawnProfileEnvResult;
}>;
