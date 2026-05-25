import { existsSync, readFileSync } from 'node:fs';

import { resolveProvisionedProfileCredentialPaths, type ProvisionableProfileBackendId } from './profileProvisionPaths';

function readJsonRecord(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasStringField(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0;
}

function hasClaudeCredentials(path: string): boolean {
  const record = readJsonRecord(path);
  return record ? hasStringField(record, 'accessToken') : false;
}

function hasCodexCredentials(path: string): boolean {
  const record = readJsonRecord(path);
  const tokens = record?.tokens;
  if (typeof tokens === 'object' && tokens !== null && !Array.isArray(tokens)) {
    return hasStringField(tokens as Record<string, unknown>, 'access_token');
  }
  return hasStringField(record ?? {}, 'access_token');
}

export function isProfileProvisioned(
  profileId: string,
  backendId: ProvisionableProfileBackendId,
  activeServerDir: string,
): boolean {
  return resolveProvisionedProfileCredentialPaths({ activeServerDir, backendId, profileId }).some((credentialPath) => (
    existsSync(credentialPath)
      && (backendId === 'claude' ? hasClaudeCredentials(credentialPath) : hasCodexCredentials(credentialPath))
  ));
}
