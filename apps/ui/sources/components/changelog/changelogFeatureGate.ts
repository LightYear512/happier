import type { FeatureId } from '@happier-dev/protocol';

import { getFeatureBuildPolicyDecision } from '@/sync/domains/features/featureBuildPolicy';

const CHANGELOG_FEATURE_ID = 'app.ui.changelog' as const satisfies FeatureId;

export function isChangelogScreenBuildEnabled(): boolean {
    return getFeatureBuildPolicyDecision(CHANGELOG_FEATURE_ID) !== 'deny';
}
