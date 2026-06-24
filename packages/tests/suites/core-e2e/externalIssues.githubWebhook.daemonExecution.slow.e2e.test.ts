import { afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createTestAuth } from '../../src/testkit/auth';
import { seedCliAuthForServer } from '../../src/testkit/cliAuth';
import { startTestDaemon, type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { envFlag } from '../../src/testkit/env';
import { FailureArtifacts } from '../../src/testkit/failureArtifacts';
import { fakeClaudeFixturePath } from '../../src/testkit/fakeClaude';
import { fetchJson } from '../../src/testkit/http';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createRunDirs } from '../../src/testkit/runDir';
import { waitFor } from '../../src/testkit/timing';

type RepositoryConnection = Readonly<{
  id: string;
}>;

type ExternalIssue = Readonly<{
  id: string;
}>;

type SessionRunSummary = Readonly<{
  id: string;
  state?: string;
  claimedByMachineId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}>;

type ProviderActionSummary = Readonly<{
  actionKind?: string;
  sessionRunId?: string | null;
  state?: string;
  claimedByExecutorId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}>;

type ExternalIssueExecutionState = Readonly<{
  issue: ExternalIssue;
  workflow: Readonly<{
    workflowState: string;
    activePrimaryRunId?: string | null;
  }> | null;
  latestRuns: readonly SessionRunSummary[];
  providerActions: readonly ProviderActionSummary[];
}>;

const run = createRunDirs({ runLabel: 'core' });

function authHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

async function postJson<T>(params: Readonly<{
  url: string;
  token?: string;
  body: unknown;
  headers?: HeadersInit;
}>): Promise<T> {
  const headers = params.token
    ? { ...authHeaders(params.token), ...(params.headers ?? {}) }
    : { 'content-type': 'application/json', ...(params.headers ?? {}) };
  const response = await fetchJson<T>(params.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params.body),
  });
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  return response.data;
}

async function getJson<T>(params: Readonly<{
  url: string;
  token: string;
}>): Promise<T> {
  const response = await fetchJson<T>(params.url, {
    method: 'GET',
    headers: authHeaders(params.token),
  });
  expect(response.status).toBe(200);
  return response.data;
}

describe('core e2e: external issue webhook daemon execution', () => {
  let server: StartedServer | null = null;
  let daemon: StartedDaemon | null = null;

  afterAll(async () => {
    await daemon?.stop().catch(() => {});
    await server?.stop();
  });

  it('queues a GitHub issue webhook and the daemon executes the session run to an observable terminal state', async () => {
    const testDir = run.testDir('external-issues-github-webhook-daemon-execution');
    const saveArtifactsOnSuccess = envFlag(['HAPPIER_E2E_SAVE_ARTIFACTS', 'HAPPY_E2E_SAVE_ARTIFACTS'], false);
    const artifacts = new FailureArtifacts();

    server = await startServerLight({ testDir });
    const serverBaseUrl = server.baseUrl;
    const auth = await createTestAuth(serverBaseUrl);

    const daemonHomeDir = resolve(join(testDir, 'daemon-home'));
    const workspaceDir = resolve(join(testDir, 'workspace'));
    await mkdir(daemonHomeDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    const seeded = await seedCliAuthForServer({
      cliHome: daemonHomeDir,
      serverUrl: serverBaseUrl,
      token: auth.token,
      secret: Uint8Array.from(randomBytes(32)),
    });

    daemon = await startTestDaemon({
      testDir,
      happyHomeDir: daemonHomeDir,
      snapshotDir: resolve(join(testDir, 'cli-dist')),
      env: {
        ...process.env,
        CI: '1',
        HAPPIER_VARIANT: 'dev',
        HAPPIER_DISABLE_CAFFEINATE: '1',
        HAPPIER_HOME_DIR: daemonHomeDir,
        HAPPIER_SERVER_URL: serverBaseUrl,
        HAPPIER_WEBAPP_URL: serverBaseUrl,
        HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
        HAPPIER_CLAUDE_PATH: fakeClaudeFixturePath(),
        HAPPIER_EXTERNAL_ISSUE_SESSION_RUN_CLAIM_POLL_MS: '250',
        HAPPIER_EXTERNAL_ISSUE_SESSION_RUN_LEASE_MS: '5000',
        HAPPIER_EXTERNAL_ISSUE_SESSION_RUN_HEARTBEAT_MS: '500',
        HAPPIER_PROVIDER_ACTION_CLAIM_POLL_MS: '250',
        HAPPIER_PROVIDER_ACTION_LEASE_MS: '5000',
        HAPPIER_PROVIDER_ACTION_HEARTBEAT_MS: '500',
        HAPPIER_EXTERNAL_ISSUE_PROVIDER_ACTION_DRY_RUN: '1',
        HAPPIER_EXTERNAL_ISSUE_REPOSITORY_POLL_MS: '5000',
        HAPPIER_EXTERNAL_ISSUE_CHECKOUT_SYNC_INTERVAL_MS: '5000',
      },
      startupTimeoutMs: 90_000,
    });

    const connectionResponse = await postJson<{ connection: RepositoryConnection }>({
      url: `${serverBaseUrl}/v2/repositories/connections`,
      token: auth.token,
      body: {
        provider: 'github',
        providerBaseUrl: 'https://github.com',
        repositoryKey: 'acme/worker',
        mode: 'quickstart',
        authKind: 'gh_cli',
        pollerEnabled: false,
      },
    });
    const connectionId = connectionResponse.connection.id;

    await waitFor(async () => {
      const bindResponse = await fetchJson<{ ok: boolean }>(
        `${serverBaseUrl}/v2/repositories/connections/${connectionId}/local-checkout`,
        {
          method: 'POST',
          headers: authHeaders(auth.token),
          body: JSON.stringify({
            machineId: seeded.machineId,
            localCheckoutPath: workspaceDir,
          }),
          timeoutMs: 5_000,
        },
      );
      return bindResponse.status === 200 && bindResponse.data.ok === true;
    }, { timeoutMs: 30_000, intervalMs: 250, context: 'bind local checkout after daemon registers machine' });

    const deliveryId = randomUUID();
    await postJson<{ recorded: boolean; deduped: boolean }>({
      url: `${serverBaseUrl}/v1/integrations/github/webhook`,
      headers: {
        'x-github-event': 'issues',
        'x-github-delivery': deliveryId,
      },
      body: {
        action: 'opened',
        repository: {
          full_name: 'acme/worker',
          html_url: 'https://github.com/acme/worker',
        },
        issue: {
          number: 42,
          title: 'Automate external issue execution',
          state: 'open',
          html_url: 'https://github.com/acme/worker/issues/42',
        },
      },
    });

    let issueId: string | null = null;
    artifacts.json('external-issues.json', async () => await getJson<unknown>({
      url: `${serverBaseUrl}/v2/external-issues?repositoryConnectionId=${encodeURIComponent(connectionId)}`,
      token: auth.token,
    }));
    artifacts.json('execution-state.json', async () => issueId
      ? await getJson<unknown>({
          url: `${serverBaseUrl}/v2/external-issues/${issueId}/execution-state`,
          token: auth.token,
        })
      : { issueId: null });

    let passed = false;
    try {
      await waitFor(async () => {
        const issuesResponse = await getJson<{ issues: ExternalIssue[] }>({
          url: `${serverBaseUrl}/v2/external-issues?repositoryConnectionId=${encodeURIComponent(connectionId)}`,
          token: auth.token,
        });
        issueId = issuesResponse.issues[0]?.id ?? null;
        return typeof issueId === 'string' && issueId.length > 0;
      }, { timeoutMs: 30_000, intervalMs: 250, context: 'external issue from GitHub webhook' });

      await waitFor(async () => {
        if (!issueId) return false;
        const executionState = await getJson<ExternalIssueExecutionState>({
          url: `${serverBaseUrl}/v2/external-issues/${issueId}/execution-state`,
          token: auth.token,
        });
        const latestRun = executionState.latestRuns[0];
        const linkBackAction = executionState.providerActions.find((action) => (
          action.actionKind === 'issue_link_back' &&
          action.sessionRunId === latestRun?.id
        ));
        return (
          executionState.workflow?.workflowState === 'awaiting_review' &&
          executionState.workflow.activePrimaryRunId == null &&
          latestRun?.state === 'succeeded' &&
          latestRun.claimedByMachineId === seeded.machineId &&
          typeof latestRun.startedAt === 'string' &&
          typeof latestRun.finishedAt === 'string' &&
          linkBackAction?.state === 'succeeded' &&
          linkBackAction.claimedByExecutorId === seeded.machineId &&
          typeof linkBackAction.startedAt === 'string' &&
          typeof linkBackAction.finishedAt === 'string'
        );
      }, { timeoutMs: 90_000, intervalMs: 500, context: 'daemon executes queued external issue run and provider action' });

      passed = true;
    } finally {
      await artifacts.dumpAll(testDir, { onlyIf: saveArtifactsOnSuccess || !passed });
    }
  }, 240_000);
});
