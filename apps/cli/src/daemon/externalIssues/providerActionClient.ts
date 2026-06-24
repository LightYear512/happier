import axios from 'axios';

import { configuration } from '@/configuration';
import type { ProviderActionClaimResponse } from './providerActionTypes';

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export type ProviderActionClient = ReturnType<typeof createProviderActionClient>;

export function createProviderActionClient(params: { token: string }) {
  const baseUrl = configuration.apiServerUrl;
  const token = params.token;

  return {
    async claimAction(paramsClaim: {
      machineId: string;
      leaseDurationMs: number;
    }): Promise<ProviderActionClaimResponse> {
      const response = await axios.post<ProviderActionClaimResponse>(
        `${baseUrl}/v2/provider-actions/claim`,
        {
          machineId: paramsClaim.machineId,
          leaseDurationMs: paramsClaim.leaseDurationMs,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
      return response.data;
    },

    async startAction(paramsStart: {
      actionId: string;
      machineId: string;
    }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/provider-actions/${encodeURIComponent(paramsStart.actionId)}/start`,
        {
          machineId: paramsStart.machineId,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },

    async heartbeatAction(paramsHeartbeat: {
      actionId: string;
      machineId: string;
      leaseDurationMs: number;
    }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/provider-actions/${encodeURIComponent(paramsHeartbeat.actionId)}/heartbeat`,
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

    async succeedAction(paramsSucceed: {
      actionId: string;
      machineId: string;
      providerExternalId?: string;
      summary?: string;
    }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/provider-actions/${encodeURIComponent(paramsSucceed.actionId)}/succeed`,
        {
          machineId: paramsSucceed.machineId,
          providerExternalId: paramsSucceed.providerExternalId,
          summary: paramsSucceed.summary,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },

    async failAction(paramsFail: {
      actionId: string;
      machineId: string;
      errorCode: string;
      errorMessage: string;
      retryRecommended?: boolean;
    }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/provider-actions/${encodeURIComponent(paramsFail.actionId)}/fail`,
        {
          machineId: paramsFail.machineId,
          errorCode: paramsFail.errorCode,
          errorMessage: paramsFail.errorMessage,
          retryRecommended: paramsFail.retryRecommended,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },
  };
}
