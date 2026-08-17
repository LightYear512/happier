import { afterEach, describe, expect, it } from 'vitest';

import { en } from './translations/en';
import { ru } from './translations/ru';
import { hasTranslation, setPreferredLanguageFromSettings, t, tLoose } from './i18n';

describe('text/i18n', () => {
    afterEach(() => {
        setPreferredLanguageFromSettings(null);
    });

    it('translates the default language and nested function entries', () => {
        expect(t('tabs.inbox')).toBe(en.tabs.inbox);
        expect(t('promptLibrary.profileStacksSubtitle', { count: 2 })).toBe(en.promptLibrary.profileStacksSubtitle({ count: 2 }));
        expect(tLoose('tabs.inbox')).toBe(en.tabs.inbox);
    });

    it('reports missing keys without throwing', () => {
        expect(hasTranslation('tabs.inbox')).toBe(true);
        expect(hasTranslation('not.a.real.key')).toBe(false);
        expect(tLoose('not.a.real.key')).toBe('not.a.real.key');
    });

    it('resolves a non-default preferred language and returns to the default when it is cleared', () => {
        // Locale trees are materialized lazily, so a preferred language that is not the default is
        // the case that proves the right tree is reachable rather than silently falling back to `en`.
        const ruInbox = ru.tabs?.inbox;
        const ruProfileStacksSubtitle = ru.promptLibrary?.profileStacksSubtitle;
        expect(ruInbox).toEqual(expect.any(String));
        expect(ruProfileStacksSubtitle).toEqual(expect.any(Function));
        expect(ruInbox).not.toBe(en.tabs.inbox);

        setPreferredLanguageFromSettings('ru');
        expect(t('tabs.inbox')).toBe(ruInbox);
        expect(t('promptLibrary.profileStacksSubtitle', { count: 2 })).toBe(
            ruProfileStacksSubtitle!({ count: 2 }),
        );

        setPreferredLanguageFromSettings(null);
        expect(t('tabs.inbox')).toBe(en.tabs.inbox);
    });

    it('ignores an unsupported preferred language instead of losing translations', () => {
        setPreferredLanguageFromSettings('kl');
        expect(t('tabs.inbox')).toBe(en.tabs.inbox);
    });
});
