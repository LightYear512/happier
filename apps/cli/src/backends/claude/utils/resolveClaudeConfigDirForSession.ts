import { isProfileProvisioned } from '@/auth/provision/isProfileProvisioned';
import { resolveProvisionedProfileDir } from '@/auth/provision/profileProvisionPaths';
import { resolveClaudeConfigDirOverride } from './resolveClaudeConfigDirOverride';

export type ResolveClaudeConfigDirForSessionResult =
  | { status: 'ok'; configDir: string }
  | { status: 'profile_not_provisioned'; profileId: string; expectedDir: string }
  | { status: 'fallback'; configDir: string | null };

export function resolveClaudeConfigDirForSession(params: Readonly<{
  profileId: string | null | undefined;
  env: NodeJS.ProcessEnv;
  activeServerDir: string;
}>): ResolveClaudeConfigDirForSessionResult {
  const profileId = typeof params.profileId === 'string' ? params.profileId.trim() : '';
  if (!profileId) {
    return { status: 'fallback', configDir: resolveClaudeConfigDirOverride(params.env) };
  }

  const profileDir = resolveProvisionedProfileDir({
    activeServerDir: params.activeServerDir,
    backendId: 'claude',
    profileId,
  });
  if (!isProfileProvisioned(profileId, 'claude', params.activeServerDir)) {
    return { status: 'profile_not_provisioned', profileId, expectedDir: profileDir };
  }

  return { status: 'ok', configDir: profileDir };
}
