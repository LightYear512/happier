import { classifyAutomationWorkerError, nextAutomationRetryDelayMs } from '@/daemon/automation/automationBackoffPolicy';
import { startSingleFlightIntervalLoop, type SingleFlightIntervalLoopHandle } from '@/daemon/lifecycle/singleFlightIntervalLoop';
import { createRepositoryConnectionPollerClient } from './repositoryConnectionPollerClient';
import { fetchRepositoryConnectionProviderEvents } from './repositoryConnectionProviderEventFetcher';
import { logExternalIssueSessionRunInfo, logExternalIssueSessionRunWarn } from './externalIssueSessionRunTelemetry';
import type {
  NormalizedRepositoryProviderEvent,
  RepositoryConnectionPollerConnection,
} from './repositoryConnectionPollerTypes';

export type RepositoryConnectionPollerWorkerHandle = Readonly<{
  stop: () => void;
  refresh: () => Promise<void>;
  pause: () => void;
  resume: () => void;
}>;

export type RepositoryConnectionEventFetcher = (
  connection: RepositoryConnectionPollerConnection,
) => Promise<NormalizedRepositoryProviderEvent[]>;

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolvePollerConfig(env: NodeJS.ProcessEnv): {
  intervalMs: number;
  leaseDurationMs: number;
} {
  return {
    intervalMs: readInt(
      env.HAPPIER_EXTERNAL_ISSUE_REPOSITORY_POLLER_INTERVAL_MS,
      60_000,
      5_000,
      15 * 60_000,
    ),
    leaseDurationMs: readInt(
      env.HAPPIER_EXTERNAL_ISSUE_REPOSITORY_POLLER_LEASE_MS,
      60_000,
      5_000,
      15 * 60_000,
    ),
  };
}

export function startRepositoryConnectionPollerWorker(params: {
  token: string;
  machineId: string;
  env?: NodeJS.ProcessEnv;
  fetchEvents?: RepositoryConnectionEventFetcher;
}): RepositoryConnectionPollerWorkerHandle {
  const env = params.env ?? process.env;
  const config = resolvePollerConfig(env);
  const client = createRepositoryConnectionPollerClient({ token: params.token });
  const fetchEvents = params.fetchEvents ?? ((connection) => fetchRepositoryConnectionProviderEvents({ connection, env }));

  let stopped = false;
  let paused = false;
  let retryAfter = 0;
  let consecutiveFailures = 0;
  let loop: SingleFlightIntervalLoopHandle | null = null;

  async function pollConnection(connection: RepositoryConnectionPollerConnection): Promise<void> {
    await client.claimPollLease({
      connectionId: connection.id,
      machineId: params.machineId,
      leaseDurationMs: config.leaseDurationMs,
    });
    await client.heartbeatPollLease({
      connectionId: connection.id,
      machineId: params.machineId,
      leaseDurationMs: config.leaseDurationMs,
    });

    const events = await fetchEvents(connection);
    if (events.length === 0) return;

    await client.pushEvents({
      connectionId: connection.id,
      machineId: params.machineId,
      events,
    });
  }

  async function refresh(): Promise<void> {
    if (stopped || paused) return;
    if (Date.now() < retryAfter) return;

    try {
      const listed = await client.listConnections({ enabled: true });
      const pollableConnections = listed.connections.filter((connection) => (
        connection.enabled && connection.pollerEnabled === true
      ));

      for (const connection of pollableConnections) {
        if (stopped || paused) return;
        await pollConnection(connection);
      }

      consecutiveFailures = 0;
      retryAfter = 0;
    } catch (error) {
      const errorClass = classifyAutomationWorkerError(error);
      consecutiveFailures = errorClass === 'transient' ? consecutiveFailures + 1 : 0;
      const backoffMs = nextAutomationRetryDelayMs({
        failureCount: consecutiveFailures,
        error,
      });
      retryAfter = Date.now() + backoffMs;
      logExternalIssueSessionRunWarn('Repository poller refresh failed', error, {
        machineId: params.machineId,
        errorClass,
        consecutiveFailures,
        backoffMs,
      });
    }
  }

  loop = startSingleFlightIntervalLoop({
    intervalMs: config.intervalMs,
    task: refresh,
  });
  loop.trigger();

  logExternalIssueSessionRunInfo('Repository poller worker started', {
    machineId: params.machineId,
    intervalMs: config.intervalMs,
    leaseDurationMs: config.leaseDurationMs,
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      loop?.stop();
      logExternalIssueSessionRunInfo('Repository poller worker stopped', {
        machineId: params.machineId,
      });
    },
    refresh,
    pause: () => {
      if (stopped || paused) return;
      paused = true;
      loop?.pause();
    },
    resume: () => {
      if (stopped || !paused) return;
      paused = false;
      loop?.resume();
      loop?.trigger();
    },
  };
}
