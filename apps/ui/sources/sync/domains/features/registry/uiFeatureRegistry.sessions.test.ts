import { describe, expect, it } from 'vitest';

import {
    buildUiFeatureToggleDefaults,
    listUiFeatureToggleDefinitions,
    resolveUiFeatureToggleEnabled,
} from './uiFeatureToggles';

describe('UI sessions feature registry', () => {
    it('registers sessions.devPreview as an opt-in experimental settings toggle', () => {
        const devPreview = listUiFeatureToggleDefinitions().find((definition) => (
            definition.featureId === 'sessions.devPreview'
        ));

        expect(devPreview).toMatchObject({
            featureId: 'sessions.devPreview',
            isExperimental: true,
            defaultEnabled: false,
            serverVisibilityScope: 'main_selection',
        });
    });

    it('resolves sessions.devPreview through the experimental feature toggle map', () => {
        expect(resolveUiFeatureToggleEnabled({
            experiments: false,
            featureToggles: { 'sessions.devPreview': true },
        }, 'sessions.devPreview')).toBe(false);

        expect(resolveUiFeatureToggleEnabled({
            experiments: true,
            featureToggles: {},
        }, 'sessions.devPreview')).toBe(false);

        expect(resolveUiFeatureToggleEnabled({
            experiments: true,
            featureToggles: { 'sessions.devPreview': true },
        }, 'sessions.devPreview')).toBe(true);
    });

    it('does not auto-enable sessions.devPreview when experiments are seeded', () => {
        expect(buildUiFeatureToggleDefaults({ experimentalOnly: true })['sessions.devPreview']).toBe(false);
    });
});
