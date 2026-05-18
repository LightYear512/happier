import { isProfileProvisioned } from '@/auth/provision/isProfileProvisioned';
import { resolveProvisionedProfileDir } from '@/auth/provision/profileProvisionPaths';
import { resolveConfiguredCodexHome } from './resolveConfiguredCodexHome';

export type ResolveCodexHomeForSessionResult =
  | { status: 'ok'; codexHome: string }
  | { status: 'profile_not_provisioned'; profileId: string; expectedDir: string }
  | { status: 'fallback'; codexHome: string };

export function resolveCodexHomeForSession(params: Readonly<{
  profileId: string | null | undefined;
  env: NodeJS.ProcessEnv;
  activeServerDir: string;
}>): ResolveCodexHomeForSessionResult {
  const profileId = typeof params.profileId === 'string' ? params.profileId.trim() : '';
  if (!profileId) {
    return { status: 'fallback', codexHome: resolveConfiguredCodexHome(params.env) };
  }

  const profileDir = resolveProvisionedProfileDir({
    activeServerDir: params.activeServerDir,
    backendId: 'codex',
    profileId,
  });
  if (!isProfileProvisioned(profileId, 'codex', params.activeServerDir)) {
    return { status: 'profile_not_provisioned', profileId, expectedDir: profileDir };
  }

  return { status: 'ok', codexHome: profileDir };
}
