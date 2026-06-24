import { classifyAutomationWorkerError, nextAutomationRetryDelayMs } from '@/daemon/automation/automationBackoffPolicy';
import { startSingleFlightIntervalLoop, type SingleFlightIntervalLoopHandle } from '@/daemon/lifecycle/singleFlightIntervalLoop';
import type { Update } from '@/api/types';
import { createProviderActionClient } from './providerActionClient';
import { executeClaimedProviderAction } from './providerActionExecutor';
import { logExternalIssueSessionRunInfo, logExternalIssueSessionRunWarn } from './externalIssueSessionRunTelemetry';

export type ProviderActionWorkerHandle = Readonly<{
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

function resolveProviderActionWorkerConfig(env: NodeJS.ProcessEnv): {
  claimPollMs: number;
  leaseDurationMs: number;
  heartbeatMs: number;
} {
  const leaseDurationMs = readInt(
    env.HAPPIER_PROVIDER_ACTION_LEASE_MS,
    30_000,
    5_000,
    15 * 60_000,
  );
  return {
    claimPollMs: readInt(env.HAPPIER_PROVIDER_ACTION_CLAIM_POLL_MS, 5_000, 1_000, 120_000),
    leaseDurationMs,
    heartbeatMs: readInt(
      env.HAPPIER_PROVIDER_ACTION_HEARTBEAT_MS,
      Math.floor(leaseDurationMs / 2),
      1_000,
      60_000,
    ),
  };
}

export function startProviderActionWorker(params: {
  token: string;
  machineId: string;
  env?: NodeJS.ProcessEnv;
}): ProviderActionWorkerHandle {
  const env = params.env ?? process.env;
  const config = resolveProviderActionWorkerConfig(env);
  const client = createProviderActionClient({ token: params.token });

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
      const claim = await client.claimAction({
        machineId: params.machineId,
        leaseDurationMs: config.leaseDurationMs,
      });
      if (!claim.action) {
        consecutiveFailures = 0;
        retryAfter = 0;
        scheduleClaimAt(Date.now() + config.claimPollMs);
        return;
      }

      await executeClaimedProviderAction({
        machineId: params.machineId,
        client,
        heartbeatMs: config.heartbeatMs,
        leaseDurationMs: config.leaseDurationMs,
        action: claim.action,
        env,
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
      logExternalIssueSessionRunWarn('Provider action worker tick failed', error, {
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

  logExternalIssueSessionRunInfo('Provider action worker started', {
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
      logExternalIssueSessionRunInfo('Provider action worker stopped', {
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
      if (body.t === 'provider-action-updated' && body.state === 'queued') {
        scheduleClaimSoon();
      }
    },
  };
}
