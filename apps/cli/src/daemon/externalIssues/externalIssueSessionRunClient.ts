import axios from 'axios';

import { configuration } from '@/configuration';
import type { ExternalIssueSessionRunClaimResponse, ExternalIssueSessionRunDetail } from './externalIssueSessionRunTypes';

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export type ExternalIssueSessionRunClient = ReturnType<typeof createExternalIssueSessionRunClient>;

export function createExternalIssueSessionRunClient(params: { token: string }) {
  const baseUrl = configuration.apiServerUrl;
  const token = params.token;

  return {
    async claimRun(paramsClaim: { machineId: string; leaseDurationMs: number }): Promise<ExternalIssueSessionRunClaimResponse> {
      const response = await axios.post<ExternalIssueSessionRunClaimResponse>(
        `${baseUrl}/v2/session-runs/claim`,
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

    async getRun(runId: string): Promise<ExternalIssueSessionRunDetail> {
      const response = await axios.get<ExternalIssueSessionRunDetail>(
        `${baseUrl}/v2/session-runs/${encodeURIComponent(runId)}`,
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
      return response.data;
    },

    async startRun(paramsStart: { runId: string; machineId: string; generation: number }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/session-runs/${encodeURIComponent(paramsStart.runId)}/start`,
        {
          machineId: paramsStart.machineId,
          generation: paramsStart.generation,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },

    async heartbeatRun(paramsHeartbeat: {
      runId: string;
      machineId: string;
      generation: number;
      leaseDurationMs: number;
    }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/session-runs/${encodeURIComponent(paramsHeartbeat.runId)}/heartbeat`,
        {
          machineId: paramsHeartbeat.machineId,
          generation: paramsHeartbeat.generation,
          leaseDurationMs: paramsHeartbeat.leaseDurationMs,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },

    async succeedRun(paramsSucceed: {
      runId: string;
      machineId: string;
      generation: number;
      producedSessionId?: string | null;
    }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/session-runs/${encodeURIComponent(paramsSucceed.runId)}/succeed`,
        {
          machineId: paramsSucceed.machineId,
          generation: paramsSucceed.generation,
          producedSessionId: paramsSucceed.producedSessionId ?? null,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },

    async failRun(paramsFail: {
      runId: string;
      machineId: string;
      generation: number;
      errorCode: string;
      errorMessage: string;
    }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/session-runs/${encodeURIComponent(paramsFail.runId)}/fail`,
        {
          machineId: paramsFail.machineId,
          generation: paramsFail.generation,
          errorCode: paramsFail.errorCode,
          errorMessage: paramsFail.errorMessage,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },

    async expireStale(paramsExpire: { machineId: string; limit: number }): Promise<void> {
      await axios.post(
        `${baseUrl}/v2/session-runs/expire-stale`,
        {
          machineId: paramsExpire.machineId,
          limit: paramsExpire.limit,
        },
        {
          headers: authHeaders(token),
          timeout: 15_000,
        },
      );
    },
  };
}
