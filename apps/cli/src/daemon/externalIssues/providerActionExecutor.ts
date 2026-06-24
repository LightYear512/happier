import { startAutomationLeaseHeartbeat } from '@/daemon/automation/automationLeaseHeartbeat';
import { logExternalIssueSessionRunWarn } from './externalIssueSessionRunTelemetry';
import type { ProviderActionClient } from './providerActionClient';
import type { ProviderAction } from './providerActionTypes';
import { ProviderActionExecutionError } from './providerActionExecutionError';
import { writeGitHubIssueLinkBack } from './githubIssueLinkBack';

export async function executeClaimedProviderAction(params: {
  machineId: string;
  client: Pick<ProviderActionClient, 'startAction' | 'heartbeatAction' | 'succeedAction' | 'failAction'>;
  heartbeatMs: number;
  leaseDurationMs: number;
  action: ProviderAction;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const actionParams = {
    actionId: params.action.id,
    machineId: params.machineId,
  };

  await params.client.startAction(actionParams);
  const heartbeat = startAutomationLeaseHeartbeat({
    heartbeatMs: params.heartbeatMs,
    onHeartbeat: async () => {
      await params.client.heartbeatAction({
        ...actionParams,
        leaseDurationMs: params.leaseDurationMs,
      });
    },
    onError: (error) => {
      logExternalIssueSessionRunWarn('Provider action lease heartbeat failed', error, {
        actionId: params.action.id,
        actionKind: params.action.actionKind,
      });
    },
  });

  try {
    if (
      params.action.actionKind === 'issue_link_back' &&
      params.action.executionMode === 'machine_runtime'
    ) {
      if (params.action.provider !== 'github') {
        await params.client.failAction({
          ...actionParams,
          errorCode: 'unsupported_provider_action',
          errorMessage: `Unsupported issue link-back provider: ${params.action.provider ?? 'unknown'}`,
          retryRecommended: false,
        });
        return;
      }
      const result = await writeGitHubIssueLinkBack({
        action: params.action,
        env: params.env,
      });
      await params.client.succeedAction({
        ...actionParams,
        providerExternalId: result.providerExternalId,
        summary: result.summary,
      });
      return;
    }

    await params.client.failAction({
      ...actionParams,
      errorCode: 'unsupported_provider_action',
      errorMessage: `Unsupported provider action: ${params.action.actionKind}`,
      retryRecommended: false,
    });
  } catch (error) {
    if (error instanceof ProviderActionExecutionError) {
      await params.client.failAction({
        ...actionParams,
        errorCode: error.errorCode,
        errorMessage: error.message,
        retryRecommended: error.retryRecommended,
      });
      return;
    }
    await params.client.failAction({
      ...actionParams,
      errorCode: 'unexpected_error',
      errorMessage: error instanceof Error ? error.message : String(error),
      retryRecommended: true,
    }).catch((innerError) => {
      logExternalIssueSessionRunWarn('Failed to record provider action failure', innerError, {
        actionId: params.action.id,
        actionKind: params.action.actionKind,
      });
    });
  } finally {
    heartbeat.stop();
  }
}
