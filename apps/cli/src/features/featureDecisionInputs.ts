import {
  featureRequiresServerSnapshot,
  type AccountSettings,
  type FeatureId,
} from '@happier-dev/protocol';

import { getCliFeatureBuildPolicyDecision } from './featureBuildPolicy';
import { resolveCliLocalFeaturePolicyEnabled } from './featureLocalPolicy';
import { resolveCliGlobalOnlyFeatureDecision } from './featureDecisionGlobalOnly';
import {
  fetchServerFeaturesSnapshot,
  type CliServerFeaturesSnapshot,
} from './serverFeaturesClient';

export type CliFeatureDecisionInputs = Readonly<{
  featureId: FeatureId;
  env: NodeJS.ProcessEnv;
  buildPolicy: 'allow' | 'deny' | 'neutral';
  localPolicyEnabled: boolean;
  accountSettings?: AccountSettings | null;
  serverSnapshot?: CliServerFeaturesSnapshot;
}>;

export function createCliFeatureDecisionInputs(params: {
  featureId: FeatureId;
  env: NodeJS.ProcessEnv;
  accountSettings?: AccountSettings | null;
  serverSnapshot?: CliServerFeaturesSnapshot;
}): CliFeatureDecisionInputs {
  return {
    featureId: params.featureId,
    env: params.env,
    buildPolicy: getCliFeatureBuildPolicyDecision(params.featureId, params.env),
    localPolicyEnabled: resolveCliLocalFeaturePolicyEnabled(params.featureId, params.env, params.accountSettings ?? null),
    accountSettings: params.accountSettings ?? null,
    serverSnapshot: params.serverSnapshot,
  };
}

export async function loadCliFeatureDecisionInputsForServer(params: {
  featureId: FeatureId;
  env: NodeJS.ProcessEnv;
  accountSettings?: AccountSettings | null;
  serverUrl: string;
  timeoutMs?: number;
}): Promise<CliFeatureDecisionInputs> {
  const globalDecision = resolveCliGlobalOnlyFeatureDecision({ featureId: params.featureId, env: params.env });
  if (globalDecision.state !== 'enabled') {
    return createCliFeatureDecisionInputs({
      featureId: params.featureId,
      env: params.env,
      accountSettings: params.accountSettings ?? null,
      serverSnapshot: undefined,
    });
  }

  if (!featureRequiresServerSnapshot(params.featureId)) {
    return createCliFeatureDecisionInputs({
      featureId: params.featureId,
      env: params.env,
      accountSettings: params.accountSettings ?? null,
      serverSnapshot: undefined,
    });
  }

  const serverSnapshot = await fetchServerFeaturesSnapshot({
    serverUrl: params.serverUrl,
    timeoutMs: params.timeoutMs,
  });

  return createCliFeatureDecisionInputs({
    featureId: params.featureId,
    env: params.env,
    accountSettings: params.accountSettings ?? null,
    serverSnapshot,
  });
}
