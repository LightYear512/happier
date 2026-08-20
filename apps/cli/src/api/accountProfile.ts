import axios from 'axios';
import { AccountProfileResponseSchema, type AccountProfileResponse } from '@happier-dev/protocol';

import {
  createAuthenticationHttpStatusError,
  createHttpStatusError,
  isAuthenticationStatus,
} from '@/api/client/httpStatusError';
import { normalizeServerHttpBaseUrl, resolveServerHttpBaseUrl } from '@/session/transport/http/serverHttpBaseUrl';

function resolveAccountProfileServerUrl(): string {
  const runtimeServerUrl =
    (process.env.HAPPIER_LOCAL_SERVER_URL ?? '').trim()
    || (process.env.HAPPIER_SERVER_URL ?? '').trim();
  return runtimeServerUrl ? normalizeServerHttpBaseUrl(runtimeServerUrl) : resolveServerHttpBaseUrl();
}

export async function fetchAccountProfile(opts: Readonly<{ token: string; signal?: AbortSignal }>): Promise<AccountProfileResponse> {
  const serverUrl = resolveAccountProfileServerUrl();
  const response = await axios.get(`${serverUrl}/v1/account/profile`, {
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
    ...(opts.signal ? { signal: opts.signal } : {}),
    validateStatus: () => true,
  });

  if (isAuthenticationStatus(response.status)) {
    throw createAuthenticationHttpStatusError(
      response.status,
      `Authentication failed while fetching account profile (${response.status})`,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw createHttpStatusError(response.status, `Failed to fetch account profile (${response.status})`);
  }

  return AccountProfileResponseSchema.parse(response.data);
}
