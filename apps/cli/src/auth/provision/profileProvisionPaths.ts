import { join, posix, win32 } from 'node:path';

export type ProvisionableProfileBackendId = 'claude' | 'codex';

const INVALID_PROFILE_ID_PATH_CHARS = /[<>:"/\\|?*\x00-\x1F]/;

export function parseProvisionedProfileId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return null;
  if (INVALID_PROFILE_ID_PATH_CHARS.test(trimmed)) return null;
  if (posix.isAbsolute(trimmed) || win32.isAbsolute(trimmed)) return null;
  return trimmed;
}

export function resolveProvisionedProfileDir(params: Readonly<{
  activeServerDir: string;
  backendId: ProvisionableProfileBackendId;
  profileId: string;
}>): string {
  const profileId = parseProvisionedProfileId(params.profileId);
  if (!profileId) {
    throw new Error(`Invalid provisioned profile id: ${params.profileId}`);
  }
  return join(params.activeServerDir, 'profiles', 'native-cli', params.backendId, profileId);
}

export function resolveProvisionedProfileCredentialPaths(params: Readonly<{
  activeServerDir: string;
  backendId: ProvisionableProfileBackendId;
  profileId: string;
}>): string[] {
  const profileId = parseProvisionedProfileId(params.profileId);
  if (!profileId) return [];
  const profileDir = resolveProvisionedProfileDir(params);
  if (params.backendId === 'claude') {
    return [
      join(profileDir, '.credentials.json'),
      join(profileDir, '.claude.json'),
    ];
  }
  return [join(profileDir, 'auth.json')];
}
