import { readSessionDevPreviewFeatureEnv } from './catalog/readFeatureEnv';
import type { FeaturesPayloadDelta } from './types';

export function resolveSessionDevPreviewFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    const featureConfig = readSessionDevPreviewFeatureEnv(env);

    return {
        features: {
            sessions: {
                enabled: true,
                devPreview: {
                    enabled: true,
                    relay: {
                        enabled: featureConfig.relayEnabled,
                        host: {
                            enabled: featureConfig.hostEnabled,
                            configured: featureConfig.hostConfigured,
                            baseDomain: featureConfig.hostBaseDomain,
                            suggestedBaseDomain: featureConfig.suggestedHostBaseDomain,
                            source: featureConfig.hostSource,
                            ...(featureConfig.disabledReason ? { reason: featureConfig.disabledReason } : {}),
                        },
                        path: {
                            enabled: featureConfig.pathEnabled,
                        },
                    },
                },
            },
        },
    };
}
