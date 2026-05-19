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
                    },
                },
            },
        },
    };
}
