import axios from 'axios';

import { configuration } from '@/configuration';
import type {
  NormalizedRepositoryProviderEvent,
  RepositoryConnectionPollerListResponse,
  RepositoryConnectionPollerPushResponse,
} from './repositoryConnectionPollerTypes';

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export type RepositoryConnectionPollerClient = ReturnType<typeof createRepositoryConnectionPollerClient>;

export function createRepositoryConnectionPollerClient(params: { token: string }) {
  const baseUrl = configuration.apiServerUrl;
  const token = params.token;

  return {
    async listConnections(filters: {
      enabled?: boolean;
      repositoryKey?: string;
    } = {}): Promise<RepositoryConnectionPollerListResponse> {
      const query = new URLSearchParams();
      if (filters.enabled !== undefined) {
        query.set('enabled', String(filters.enabled));
      }
      if (filters.repositoryKey) {
        query.set('repositoryKey', filters.repositoryKey);
      }
      const suffix = query.toString();
      const response = await axios.get<RepositoryConnectionPollerListResponse>(
        `${baseUrl}/v2/repositories/connections${suffix ? `?${suffix}` : ''}`,
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
      return response.data;
    },

    async claimPollLease(paramsClaim: {
      connectionId: string;
      machineId: string;
      leaseDurationMs: number;
    }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/repositories/connections/${encodeURIComponent(paramsClaim.connectionId)}/poller/claim`,
        {
          machineId: paramsClaim.machineId,
          leaseDurationMs: paramsClaim.leaseDurationMs,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },

    async heartbeatPollLease(paramsHeartbeat: {
      connectionId: string;
      machineId: string;
      leaseDurationMs: number;
    }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/repositories/connections/${encodeURIComponent(paramsHeartbeat.connectionId)}/poller/heartbeat`,
        {
          machineId: paramsHeartbeat.machineId,
          leaseDurationMs: paramsHeartbeat.leaseDurationMs,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },

    async pushEvents(paramsPush: {
      connectionId: string;
      machineId: string;
      events: NormalizedRepositoryProviderEvent[];
    }): Promise<RepositoryConnectionPollerPushResponse> {
      const response = await axios.post<RepositoryConnectionPollerPushResponse>(
        `${baseUrl}/v2/repositories/connections/${encodeURIComponent(paramsPush.connectionId)}/events/push`,
        {
          machineId: paramsPush.machineId,
          events: paramsPush.events,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
      return response.data;
    },
  };
}
