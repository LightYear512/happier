import { existsSync } from 'node:fs';

import { resolveProvisionedProfileCredentialPaths, type ProvisionableProfileBackendId } from './profileProvisionPaths';

export function isProfileProvisioned(
  profileId: string,
  backendId: ProvisionableProfileBackendId,
  activeServerDir: string,
): boolean {
  return resolveProvisionedProfileCredentialPaths({ activeServerDir, backendId, profileId }).some((credentialPath) => (
    existsSync(credentialPath)
  ));
}
