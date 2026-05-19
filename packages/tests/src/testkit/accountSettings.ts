import { randomBytes } from 'node:crypto';

import { sealAccountScopedBlobCiphertext, type AccountScopedCryptoMaterial } from '@happier-dev/protocol';

import { fetchJson } from './http';

export type UpsertEncryptedAccountSettingsV2Params = Readonly<{
  baseUrl: string;
  token: string;
  settings: unknown;
}> & (
  | Readonly<{ secret: Uint8Array }>
  | Readonly<{ material: AccountScopedCryptoMaterial }>
);

function resolveAccountSettingsMaterial(params: UpsertEncryptedAccountSettingsV2Params): AccountScopedCryptoMaterial {
  return 'material' in params
    ? params.material
    : { type: 'legacy', secret: params.secret };
}

export async function upsertEncryptedAccountSettingsV2(params: UpsertEncryptedAccountSettingsV2Params): Promise<void> {
  const getRes = await fetchJson<any>(`${params.baseUrl}/v2/account/settings`, {
    headers: { Authorization: `Bearer ${params.token}` },
    timeoutMs: 20_000,
  });
  if (getRes.status !== 200 || typeof getRes.data?.version !== 'number') {
    throw new Error(`Failed to fetch current account settings version (status=${getRes.status})`);
  }

  const postRes = await fetchJson<any>(`${params.baseUrl}/v2/account/settings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expectedVersion: getRes.data.version,
      content: {
        t: 'encrypted',
        c: sealAccountScopedBlobCiphertext({
          kind: 'account_settings',
          material: resolveAccountSettingsMaterial(params),
          payload: params.settings,
          randomBytes: (length) => Uint8Array.from(randomBytes(length)),
        }),
      },
    }),
    timeoutMs: 20_000,
  });

  if (postRes.status !== 200 || postRes.data?.success !== true) {
    throw new Error(`Failed to update encrypted account settings (status=${postRes.status})`);
  }
}
