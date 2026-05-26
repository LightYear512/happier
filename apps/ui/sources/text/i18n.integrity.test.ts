import { describe, expect, it } from 'vitest';

import { en } from './translations/en';
import { ru } from './translations/ru';
import { pl } from './translations/pl';
import { es } from './translations/es';
import { it as itLocale } from './translations/it';
import { pt } from './translations/pt';
import { ca } from './translations/ca';
import { zhHans } from './translations/zh-Hans';
import { zhHant } from './translations/zh-Hant';
import { ja } from './translations/ja';

import { auditTranslations } from '../../tools/i18n/translationAudit';

const IGNORED_UNTRANSLATED_KEYS = new Set([
    'promptLibrary.supportingFilePathPlaceholder',
    'files.sourceControlOperations.update.remotes.namePlaceholder',
    'settingsSession.handoff.includeIgnoredMode.globsPlaceholder',
    'connectedServices.detail.prompts.accessTokenPlaceholder',
    'connectedServices.serviceNames.github',
    'deps.installable.githubCli.title',
    'newSession.githubCliBanner.title',
    'files.markdown',
    'settingsSession.sessionCreation.modalModeSimpleTitle',
    'settingsSession.sessionCreation.wizardPresentationAutoTitle',
    'settingsSession.promptPersonalization.title',
    'settingsSession.promptPersonalization.footer',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsTitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsEnabledSubtitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsDisabledSubtitle',
    'settingsSession.promptPersonalization.askAgentToSuggestReplyOptionsTitle',
    'settingsSession.promptPersonalization.askAgentToSuggestReplyOptionsEnabledSubtitle',
    'settingsSession.promptPersonalization.askAgentToSuggestReplyOptionsDisabledSubtitle',
]);

// This test is a drift-stopper: it fails if we introduce any *new* untranslated English strings outside
// of explicitly allowlisted scopes in `apps/ui/tools/i18n/translationAudit.ts`.
const MAX_UNTRANSLATED_STRINGS_BY_LOCALE = {
    ru: 181,
    pl: 183,
    es: 196,
    it: 199,
    pt: 182,
    ca: 182,
    'zh-Hans': 181,
    'zh-Hant': 181,
    ja: 180,
} as const satisfies Record<string, number>;

describe('i18n integrity', () => {
    it('does not increase the number of untranslated English strings', () => {
        const report = auditTranslations({
            en,
            locales: [
                { code: 'ru', root: ru },
                { code: 'pl', root: pl },
                { code: 'es', root: es },
                { code: 'it', root: itLocale },
                { code: 'pt', root: pt },
                { code: 'ca', root: ca },
                { code: 'zh-Hans', root: zhHans },
                { code: 'zh-Hant', root: zhHant },
                { code: 'ja', root: ja },
            ],
        });

        const untranslatedByLocale = Object.fromEntries(
            Object.entries(report).map(([locale, r]) => [
                locale,
                r.untranslatedStrings.filter((entry) => !IGNORED_UNTRANSLATED_KEYS.has(entry.key)),
            ]),
        );
        const excessByLocale = Object.entries(untranslatedByLocale)
            .flatMap(([locale, entries]) => {
                const max = MAX_UNTRANSLATED_STRINGS_BY_LOCALE[
                    locale as keyof typeof MAX_UNTRANSLATED_STRINGS_BY_LOCALE
                ] ?? 0;
                return entries.length > max ? entries.map((entry) => ({ ...entry, locale, max })) : [];
            });

        if (excessByLocale.length > 0) {
            const sample = excessByLocale
                .slice(0, 40)
                .map((u) => `${u.locale}: ${u.key} = ${JSON.stringify(u.value)}`)
                .join('\n');
            throw new Error(
                [
                    'Found untranslated strings identical to English above the per-locale baseline.',
                    'Translate strings or add explicit allowlist entries for intentional fallbacks.',
                    'Translate these strings in the locale files under sources/text/translations/.',
                    '',
                    'Sample:',
                    sample,
                ].join('\n')
            );
        }

        expect(excessByLocale).toEqual([]);
    });
});
