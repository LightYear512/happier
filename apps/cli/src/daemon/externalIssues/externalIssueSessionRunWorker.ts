import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from '@/rpc/handlers/registerSessionHandlers';
import { classifyAutomationWorkerError, nextAutomationRetryDelayMs } from '@/daemon/automation/automationBackoffPolicy';
import { startSingleFlightIntervalLoop, type SingleFlightIntervalLoopHandle } from '@/daemon/lifecycle/singleFlightIntervalLoop';
import type { Update } from '@/api/types';
import { createExternalIssueSessionRunClient } from './externalIssueSessionRunClient';
import { executeClaimedExternalIssueSessionRun } from './externalIssueSessionRunExecutor';
import { logExternalIssueSessionRunInfo, logExternalIssueSessionRunWarn } from './externalIssueSessionRunTelemetry';

export type ExternalIssueSessionRunWorkerHandle = Readonly<{
  stop: () => void;
  refresh: () => Promise<void>;
  handleServerUpdate: (update: Update) => void;
  pause: () => void;
  resume: () => void;
}>;

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolveSessionRunWorkerConfig(env: NodeJS.ProcessEnv): {
  claimPollMs: number;
  leaseDurationMs: number;
  heartbeatMs: number;
  expireLimit: number;
} {
  const leaseDurationMs = readInt(
    env.HAPPIER_EXTERNAL_ISSUE_SESSION_RUN_LEASE_MS,
    30_000,
    5_000,
    15 * 60_000,
  );
  return {
    claimPollMs: readInt(env.HAPPIER_EXTERNAL_ISSUE_SESSION_RUN_CLAIM_POLL_MS, 5_000, 1_000, 120_000),
    leaseDurationMs,
    heartbeatMs: readInt(
      env.HAPPIER_EXTERNAL_ISSUE_SESSION_RUN_HEARTBEAT_MS,
      Math.floor(leaseDurationMs / 2),
      1_000,
      60_000,
    ),
    expireLimit: readInt(env.HAPPIER_EXTERNAL_ISSUE_SESSION_RUN_EXPIRE_LIMIT, 25, 1, 100),
  };
}

export function startExternalIssueSessionRunWorker(params: {
  token: string;
  machineId: string;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  env?: NodeJS.ProcessEnv;
}): ExternalIssueSessionRunWorkerHandle {
  const env = params.env ?? process.env;
  const config = resolveSessionRunWorkerConfig(env);
  const claimClient = createExternalIssueSessionRunClient({ token: params.token });

  let stopped = false;
  let paused = false;
  let claimInFlight = false;
  let retryAfter = 0;
  let consecutiveFailures = 0;
  let pollLoop: SingleFlightIntervalLoopHandle | null = null;
  let claimTimer: NodeJS.Timeout | null = null;
  let claimTimerAt = 0;

  function clearClaimTimer() {
    if (!claimTimer) return;
    clearTimeout(claimTimer);
    claimTimer = null;
    claimTimerAt = 0;
  }

  function scheduleClaimAt(whenMs: number) {
    if (stopped || paused) return;
    const at = Math.max(Date.now(), Math.floor(whenMs));
    if (claimTimer && claimTimerAt > 0 && claimTimerAt <= at) {
      return;
    }
    clearClaimTimer();
    claimTimerAt = at;
    claimTimer = setTimeout(() => {
      claimTimer = null;
      claimTimerAt = 0;
      void runTick();
    }, Math.max(0, at - Date.now()));
  }

  function scheduleClaimSoon() {
    scheduleClaimAt(Date.now());
  }

  async function refresh(): Promise<void> {
    if (stopped || paused) return;
    await claimClient.expireStale({
      machineId: params.machineId,
      limit: config.expireLimit,
    }).catch((error) => {
      logExternalIssueSessionRunWarn('Failed to expire stale session runs', error, {
        machineId: params.machineId,
      });
    });
    scheduleClaimSoon();
  }

  async function runTick(): Promise<void> {
    if (stopped || paused || claimInFlight) return;
    if (Date.now() < retryAfter) {
      scheduleClaimAt(retryAfter);
      return;
    }

    try {
      claimInFlight = true;
      const claim = await claimClient.claimRun({
        machineId: params.machineId,
        leaseDurationMs: config.leaseDurationMs,
      });
      if (!claim.run) {
        consecutiveFailures = 0;
        retryAfter = 0;
        scheduleClaimAt(Date.now() + config.claimPollMs);
        return;
      }

      const detail = await claimClient.getRun(claim.run.id);
      await executeClaimedExternalIssueSessionRun({
        machineId: params.machineId,
        claimClient,
        spawnSession: params.spawnSession,
        heartbeatMs: config.heartbeatMs,
        leaseDurationMs: config.leaseDurationMs,
        detail,
      });

      consecutiveFailures = 0;
      retryAfter = 0;
      scheduleClaimSoon();
    } catch (error) {
      const errorClass = classifyAutomationWorkerError(error);
      consecutiveFailures = errorClass === 'transient' ? consecutiveFailures + 1 : 0;
      const backoffMs = nextAutomationRetryDelayMs({
        failureCount: consecutiveFailures,
        error,
      });
      retryAfter = Date.now() + backoffMs;
      logExternalIssueSessionRunWarn('Worker tick failed', error, {
        machineId: params.machineId,
        errorClass,
        consecutiveFailures,
        backoffMs,
      });
      scheduleClaimAt(retryAfter);
    } finally {
      claimInFlight = false;
    }
  }

  pollLoop = startSingleFlightIntervalLoop({
    intervalMs: config.claimPollMs,
    task: refresh,
  });
  pollLoop.trigger();

  logExternalIssueSessionRunInfo('Worker started', {
    machineId: params.machineId,
    claimPollMs: config.claimPollMs,
    leaseDurationMs: config.leaseDurationMs,
    heartbeatMs: config.heartbeatMs,
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearClaimTimer();
      pollLoop?.stop();
      logExternalIssueSessionRunInfo('Worker stopped', {
        machineId: params.machineId,
      });
    },
    refresh,
    pause: () => {
      if (stopped || paused) return;
      paused = true;
      clearClaimTimer();
      pollLoop?.pause();
    },
    resume: () => {
      if (stopped || !paused) return;
      paused = false;
      pollLoop?.resume();
      scheduleClaimSoon();
    },
    handleServerUpdate: (update: Update) => {
      if (stopped) return;
      const body = update?.body as { t?: unknown; state?: unknown } | null | undefined;
      if (!body || typeof body !== 'object') return;
      if (body.t === 'session-run-updated' && body.state === 'queued') {
        scheduleClaimSoon();
      }
    },
  };
}
