import type { DaemonSpawnHooks, DaemonSpawnProfileEnvResult } from '@/daemon/spawnHooks';
import { validateProviderCliSpawn } from '@/runtime/managedTools/validateProviderCliSpawn';
import { resolveClaudeConfigDirEnvOverlay } from '@/backends/claude/utils/resolveClaudeConfigDirEnvOverlay';
import { resolveClaudeConfigDirForSession } from '@/backends/claude/utils/resolveClaudeConfigDirForSession';

export const claudeDaemonSpawnHooks: DaemonSpawnHooks = {
  validateSpawn: async () => validateProviderCliSpawn({ agentId: 'claude' }),
  buildExtraEnvForChild: () => {
    return resolveClaudeConfigDirEnvOverlay(process.env);
  },
  resolveProfileEnvForChild: (params): DaemonSpawnProfileEnvResult => {
    const resolved = resolveClaudeConfigDirForSession(params);
    if (resolved.status === 'ok') {
      return { ok: true, env: { CLAUDE_CONFIG_DIR: resolved.configDir } };
    }
    if (resolved.status === 'profile_not_provisioned') {
      return {
        ok: false,
        reason: 'profile_not_provisioned',
        profileId: resolved.profileId,
        expectedDir: resolved.expectedDir,
      };
    }
    const env: Record<string, string> = {};
    return { ok: true, env };
  },
};
