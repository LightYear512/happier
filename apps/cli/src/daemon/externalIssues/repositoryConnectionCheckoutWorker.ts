import { startSingleFlightIntervalLoop, type SingleFlightIntervalLoopHandle } from '@/daemon/lifecycle/singleFlightIntervalLoop';
import { createRepositoryConnectionCheckoutClient } from './repositoryConnectionCheckoutClient';
import { resolveLocalRepositoryCheckout } from './resolveLocalRepositoryCheckout';
import { logExternalIssueSessionRunInfo, logExternalIssueSessionRunWarn } from './externalIssueSessionRunTelemetry';
import type { LocalRepositoryCheckout } from './repositoryConnectionCheckoutTypes';

export type RepositoryConnectionCheckoutWorkerHandle = Readonly<{
  stop: () => void;
  refresh: () => Promise<void>;
  pause: () => void;
  resume: () => void;
}>;

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeProviderBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function resolveCheckoutSyncIntervalMs(env: NodeJS.ProcessEnv): number {
  return readInt(
    env.HAPPIER_EXTERNAL_ISSUE_CHECKOUT_SYNC_INTERVAL_MS,
    60_000,
    5_000,
    15 * 60_000,
  );
}

export function startRepositoryConnectionCheckoutWorker(params: {
  token: string;
  machineId: string;
  env?: NodeJS.ProcessEnv;
  resolveCheckout?: () => Promise<LocalRepositoryCheckout | null>;
}): RepositoryConnectionCheckoutWorkerHandle {
  const env = params.env ?? process.env;
  const intervalMs = resolveCheckoutSyncIntervalMs(env);
  const client = createRepositoryConnectionCheckoutClient({ token: params.token });
  const resolveCheckout = params.resolveCheckout ?? (() => resolveLocalRepositoryCheckout({ env }));

  let stopped = false;
  let paused = false;
  let loop: SingleFlightIntervalLoopHandle | null = null;

  async function refresh(): Promise<void> {
    if (stopped || paused) return;
    try {
      const checkout = await resolveCheckout();
      if (!checkout) return;
      const providerBaseUrl = normalizeProviderBaseUrl(checkout.providerBaseUrl);
      const listed = await client.listConnections({
        enabled: true,
        repositoryKey: checkout.repositoryKey,
      });
      const matchingConnections = listed.connections.filter((connection) => (
        normalizeProviderBaseUrl(connection.providerBaseUrl) === providerBaseUrl
        && connection.repositoryKey === checkout.repositoryKey
      ));

      await Promise.all(matchingConnections.map((connection) => client.bindLocalCheckout({
        connectionId: connection.id,
        machineId: params.machineId,
        localCheckoutPath: checkout.localCheckoutPath,
      })));
    } catch (error) {
      logExternalIssueSessionRunWarn('Failed to bind local repository checkout', error, {
        machineId: params.machineId,
      });
    }
  }

  loop = startSingleFlightIntervalLoop({
    intervalMs,
    task: refresh,
  });
  loop.trigger();

  logExternalIssueSessionRunInfo('Repository checkout worker started', {
    machineId: params.machineId,
    intervalMs,
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      loop?.stop();
      logExternalIssueSessionRunInfo('Repository checkout worker stopped', {
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
