import axios from 'axios';

import { configuration } from '@/configuration';
import type {
  RepositoryConnectionCheckoutListResponse,
} from './repositoryConnectionCheckoutTypes';

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export type RepositoryConnectionCheckoutClient = ReturnType<typeof createRepositoryConnectionCheckoutClient>;

export function createRepositoryConnectionCheckoutClient(params: { token: string }) {
  const baseUrl = configuration.apiServerUrl;
  const token = params.token;

  return {
    async listConnections(filters: {
      enabled?: boolean;
      repositoryKey?: string;
    } = {}): Promise<RepositoryConnectionCheckoutListResponse> {
      const query = new URLSearchParams();
      if (filters.enabled !== undefined) {
        query.set('enabled', String(filters.enabled));
      }
      if (filters.repositoryKey) {
        query.set('repositoryKey', filters.repositoryKey);
      }
      const suffix = query.toString();
      const response = await axios.get<RepositoryConnectionCheckoutListResponse>(
        `${baseUrl}/v2/repositories/connections${suffix ? `?${suffix}` : ''}`,
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
      return response.data;
    },

    async bindLocalCheckout(paramsBind: {
      connectionId: string;
      machineId: string;
      localCheckoutPath: string;
    }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/repositories/connections/${encodeURIComponent(paramsBind.connectionId)}/local-checkout`,
        {
          machineId: paramsBind.machineId,
          localCheckoutPath: paramsBind.localCheckoutPath,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },
  };
}
