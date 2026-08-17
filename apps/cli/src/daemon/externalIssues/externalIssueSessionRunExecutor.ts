import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from '@/rpc/handlers/registerSessionHandlers';
import { createPendingFirstInput } from '@/daemon/spawn/pendingFirstInput';
import { startAutomationLeaseHeartbeat } from '@/daemon/automation/automationLeaseHeartbeat';
import { logExternalIssueSessionRunWarn } from './externalIssueSessionRunTelemetry';
import type { ExternalIssueSessionRunClient } from './externalIssueSessionRunClient';
import type { ExternalIssueSessionRunDetail } from './externalIssueSessionRunTypes';

function readMetadataObject(metadata: unknown): Record<string, unknown> | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  if (typeof metadata !== 'string') return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function resolveWorkingDirectory(detail: ExternalIssueSessionRunDetail): string | null {
  const metadata = readMetadataObject(detail.session?.metadata);
  const value = metadata?.workingDirectory;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  const capabilities = readMetadataObject(detail.repositoryConnection?.capabilities);
  const connectionValue = capabilities?.localCheckoutPath;
  return typeof connectionValue === 'string' && connectionValue.trim().length > 0
    ? connectionValue.trim()
    : null;
}

function buildInitialPrompt(detail: ExternalIssueSessionRunDetail): string {
  const issue = detail.externalIssue;
  const number = typeof issue?.issueNumber === 'number' ? `#${issue.issueNumber}` : 'external issue';
  const title = typeof issue?.title === 'string' && issue.title.trim().length > 0
    ? issue.title.trim()
    : 'Untitled issue';
  const url = typeof issue?.url === 'string' && issue.url.trim().length > 0
    ? `\nURL: ${issue.url.trim()}`
    : '';
  return `Resolve ${number}: ${title}${url}`;
}

function normalizeSpawnFailure(result: Exclude<SpawnSessionResult, { type: 'success' }>): {
  errorCode: string;
  errorMessage: string;
} {
  if (result.type === 'requestToApproveDirectoryCreation') {
    return {
      errorCode: 'directory_approval_required',
      errorMessage: `Directory creation requires approval: ${result.directory}`,
    };
  }
  return {
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  };
}

export async function executeClaimedExternalIssueSessionRun(params: {
  machineId: string;
  claimClient: Pick<ExternalIssueSessionRunClient, 'startRun' | 'heartbeatRun' | 'succeedRun' | 'failRun'>;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  heartbeatMs: number;
  leaseDurationMs: number;
  detail: ExternalIssueSessionRunDetail;
}): Promise<void> {
  const { run } = params.detail;
  const baseRunParams = {
    runId: run.id,
    machineId: params.machineId,
    generation: run.generation,
  };

  const directory = resolveWorkingDirectory(params.detail);
  if (!directory) {
    await params.claimClient.failRun({
      ...baseRunParams,
      errorCode: 'missing_working_directory',
      errorMessage: 'External issue session run cannot start without a session working directory.',
    });
    return;
  }

  await params.claimClient.startRun(baseRunParams);

  const heartbeat = startAutomationLeaseHeartbeat({
    heartbeatMs: params.heartbeatMs,
    onHeartbeat: async () => {
      await params.claimClient.heartbeatRun({
        ...baseRunParams,
        leaseDurationMs: params.leaseDurationMs,
      });
    },
    onError: (error) => {
      logExternalIssueSessionRunWarn('Lease heartbeat failed', error, {
        runId: run.id,
        sessionId: run.sessionId,
      });
    },
  });

  try {
    const spawnNonce = `external-issue-session-run:${run.id}:${run.generation}`;
    const spawnResult = await params.spawnSession({
      directory,
      existingSessionId: run.sessionId,
      sessionId: run.sessionId,
      machineId: params.machineId,
      spawnNonce,
      pendingFirstInput: createPendingFirstInput({
        text: buildInitialPrompt(params.detail),
        spawnNonce,
      }),
    });

    if (spawnResult.type === 'success') {
      await params.claimClient.succeedRun({
        ...baseRunParams,
        producedSessionId: spawnResult.sessionId ?? run.sessionId,
      });
      return;
    }

    await params.claimClient.failRun({
      ...baseRunParams,
      ...normalizeSpawnFailure(spawnResult),
    });
  } catch (error) {
    await params.claimClient.failRun({
      ...baseRunParams,
      errorCode: 'unexpected_error',
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch((innerError) => {
      logExternalIssueSessionRunWarn('Failed to record run failure', innerError, {
        runId: run.id,
        sessionId: run.sessionId,
      });
    });
  } finally {
    heartbeat.stop();
  }
}
