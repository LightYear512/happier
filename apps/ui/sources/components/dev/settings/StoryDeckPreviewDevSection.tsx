import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ReleaseNotesStorySurface } from '@/components/changelog/releaseNotes';
import { OnboardingShowcaseStorySurface } from '@/components/onboarding/showcase';
import { Modal } from '@/modal';
import {
    getActiveManifest,
    getReleaseNotesRuntimeVersion,
    subscribeReleaseNotesRuntime,
    type ReleaseNotesRelease,
} from '@/changelog/releaseNotes';
import { ONBOARDING_SHOWCASE_MANIFEST } from '@/onboarding/showcase';
import { t } from '@/text';

type ReleaseNotesPreviewState = Readonly<{
    latestReleaseId: string | null;
    releases: readonly ReleaseNotesRelease[];
}>;

function useReleaseNotesPreviewState(): ReleaseNotesPreviewState {
    const runtimeVersion = React.useSyncExternalStore(
        subscribeReleaseNotesRuntime,
        getReleaseNotesRuntimeVersion,
        getReleaseNotesRuntimeVersion,
    );

    return React.useMemo(() => {
        const manifest = getActiveManifest();
        return {
            latestReleaseId: manifest?.latestReleaseId ?? null,
            releases: manifest?.releases ?? [],
        };
    }, [runtimeVersion]);
}

function showPreviewModal<P extends object>(params: Readonly<{
    component: React.ComponentType<P>;
    buildProps: (close: () => void) => P;
}>): void {
    let modalId: string | null = null;
    const close = () => {
        if (!modalId) return;
        Modal.hide(modalId);
        modalId = null;
    };

    modalId = Modal.show({
        component: params.component,
        onRequestClose: close,
        props: params.buildProps(close),
    });
}

export function StoryDeckPreviewDevSection() {
    const router = useRouter();
    const { latestReleaseId, releases } = useReleaseNotesPreviewState();
    const { theme } = useUnistyles();
    const accentColor = theme.colors.accent.blue;

    const openOnboardingPreview = React.useCallback(() => {
        showPreviewModal({
            component: OnboardingShowcaseStorySurface,
            buildProps: (close) => ({
                manifest: ONBOARDING_SHOWCASE_MANIFEST,
                onComplete: close,
                onDismiss: close,
                testID: 'dev-onboarding-showcase-story-preview',
            }),
        });
    }, []);

    const openReleasePreview = React.useCallback((release: ReleaseNotesRelease) => {
        showPreviewModal({
            component: ReleaseNotesStorySurface,
            buildProps: (close) => ({
                release,
                onComplete: close,
                onDismiss: close,
                onViewFullChangelog: () => {
                    close();
                    router.push('/changelog');
                },
                testID: `dev-release-notes-story-preview:${release.releaseId}`,
            }),
        });
    }, [router]);

    return (
        <ItemGroup
            title={t('settings.devStoryDeckPreviewTitle')}
            footer={t('settings.devStoryDeckPreviewFooter')}
            selectableItemCountOverride={releases.length === 0 ? 2 : 1 + releases.length}
        >
            <Item
                testID="dev-story-deck-preview-onboarding"
                title={t('settings.devStoryDeckOnboardingTitle')}
                subtitle={t('settings.devStoryDeckOnboardingSubtitle', { count: ONBOARDING_SHOWCASE_MANIFEST.cards.length })}
                icon={<Ionicons name="sparkles-outline" size={28} color={accentColor} />}
                onPress={openOnboardingPreview}
            />
            {releases.length === 0 ? (
                <Item
                    testID="dev-story-deck-preview-empty"
                    title={t('settings.devStoryDeckNoReleaseTitle')}
                    subtitle={t('settings.devStoryDeckNoReleaseSubtitle')}
                    icon={<Ionicons name="albums-outline" size={28} color={theme.colors.text.tertiary} />}
                    mode="info"
                    showChevron={false}
                />
            ) : releases.map((release) => (
                <Item
                    key={release.releaseId}
                    testID={`dev-story-deck-preview-release:${release.releaseId}`}
                    title={release.versionLabel || release.releaseId}
                    subtitle={t('settings.devStoryDeckReleaseSubtitle', { count: release.cards.length, releaseId: release.releaseId })}
                    detail={release.releaseId === latestReleaseId ? 'Latest' : undefined}
                    icon={<Ionicons name="newspaper-outline" size={28} color={accentColor} />}
                    onPress={() => openReleasePreview(release)}
                />
            ))}
        </ItemGroup>
    );
}
