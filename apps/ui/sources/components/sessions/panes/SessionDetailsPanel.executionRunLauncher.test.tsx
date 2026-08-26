import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';
import { renderScreen } from '@/dev/testkit/render/renderScreen';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));

vi.mock('@/constants/Typography', () => ({
    FontWeights: {
        regular: '400',
    },
    Typography: { default: () => ({}) },
}));

installSessionDetailsPanelCommonModuleMocks({
    icons: async () => ({
        Octicons: 'Octicons',
        Ionicons: 'Ionicons',
    }),
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: (values: any) => values?.web ?? values?.default,
            },
            ActivityIndicator: 'ActivityIndicator',
            View: 'View',
            Pressable: 'Pressable',
            ScrollView: 'ScrollView',
            AppState: {
                currentState: 'active',
                addEventListener: vi.fn(() => ({ remove: vi.fn() })),
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useLocalSetting: ((key: string) => {
                    return null;
                }) as any,
                useLocalSettingMutable: (() => [false, vi.fn()]) as any,
            },
        });
    },
});

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        closeDetails: vi.fn(),
        closeDetailsTab: vi.fn(),
        pinDetailsTab: vi.fn(),
        unpinDetailsTab: vi.fn(),
        setActiveDetailsTab: vi.fn(),
        openDetailsTab: vi.fn(),
        setDetailsTabState: vi.fn(),
        scopeState: {
            details: {
                isOpen: true,
                activeTabKey: 'execution-run-launcher:review',
                tabState: {},
                tabs: [
                    {
                        key: 'execution-run-launcher:review',
                        kind: 'executionRunLauncher',
                        title: 'Review run',
                        isPinned: false,
                        isPreview: true,
                        resource: { kind: 'executionRunLauncher', intent: 'review' },
                    },
                ],
            },
        },
    }),
}));

vi.mock('@/components/ui/scroll/useWebScrollLockBypass', () => ({
    useWebScrollLockBypass: () => {},
}));

vi.mock('@/components/appShell/panes/focusMode/usePaneFocusMode', () => ({
    usePaneFocusMode: () => ({ active: false, canEnter: false, toggle: vi.fn() }),
}));

vi.mock('@/components/sessions/shell/sessionScreenTestIds', () => ({
    resolveOptionalSessionScreenTestId: () => undefined,
    useSessionScreenTestIdsEnabled: () => false,
}));

vi.mock('@/agents/registry/sessionSubagentUiBehavior', () => ({
    renderProviderSessionDetailsTab: () => null,
    resolveProviderSessionDetailsTabIconName: () => null,
}));

const launcherViewSpy = vi.fn();

vi.mock('@/components/sessions/runs/launcher/SessionExecutionRunLauncherView', () => ({
    SessionExecutionRunLauncherView: (props: any) => {
        launcherViewSpy(props);
        return React.createElement('SessionExecutionRunLauncherView');
    },
}));

vi.mock('@/components/sessions/terminal/SessionEmbeddedTerminalPane', () => ({
    SessionEmbeddedTerminalPane: () => React.createElement('SessionEmbeddedTerminalPane'),
}));

vi.mock('@/components/sessions/devPreview/SessionLocalServicePreviewPane', () => ({
    SessionLocalServicePreviewPane: (props: any) => React.createElement('SessionLocalServicePreviewPane', props),
}));

vi.mock('@/components/sessions/simulatorPreview/SessionSimulatorPreviewPane', () => ({
    SessionSimulatorPreviewPane: (props: any) => React.createElement('SessionSimulatorPreviewPane', props),
}));

vi.mock('@/components/sessions/simulatorPreview/useSessionSimulatorPreviewControl', () => ({
    useSessionSimulatorPreviewControl: () => ({ sendInput: vi.fn(), start: vi.fn(), stop: vi.fn() }),
}));

vi.mock('@/components/sessions/simulatorPreview/useSessionSimulatorPreviewStreamUrl', () => ({
    useSessionSimulatorPreviewStreamUrl: () => null,
}));

vi.mock('@/components/sessions/files/views/SessionCommitDetailsView', () => ({
    SessionCommitDetailsView: () => React.createElement('SessionCommitDetailsView'),
}));

vi.mock('@/components/sessions/files/views/SessionFileDetailsView', () => ({
    SessionFileDetailsView: () => React.createElement('SessionFileDetailsView'),
}));

vi.mock('./SessionDetailsPanelDetailViews', () => ({
    SessionCommitDetailsViewForPanel: (props: any) => React.createElement('SessionCommitDetailsViewForPanel', props),
    SessionFileDetailsViewForPanel: (props: any) => React.createElement('SessionFileDetailsViewForPanel', props),
    SessionScmReviewDetailsViewForPanel: (props: any) => React.createElement('SessionScmReviewDetailsViewForPanel', props),
    SessionScmStashDetailsViewForPanel: (props: any) => React.createElement('SessionScmStashDetailsViewForPanel', props),
    SessionSubagentDetailsViewForPanel: (props: any) => React.createElement('SessionSubagentDetailsViewForPanel', props),
    SessionTranscriptDetailsViewForPanel: (props: any) => React.createElement('SessionTranscriptDetailsViewForPanel', props),
}));

describe('SessionDetailsPanel (execution run launcher resource)', () => {
    const getSessionDetailsPanel = async () => (await import('./SessionDetailsPanel')).SessionDetailsPanel;

    it('renders SessionExecutionRunLauncherView for execution run launcher tabs', async () => {
        launcherViewSpy.mockClear();

        const SessionDetailsPanel = await getSessionDetailsPanel();
        const screen = await renderScreen(
            <SessionDetailsPanel sessionId="s1" scopeId="session:s1" />,
            { flushOptions: { cycles: 0 } },
        );

        expect(launcherViewSpy).toHaveBeenCalledTimes(1);
        expect(launcherViewSpy.mock.calls[0]?.[0]).toMatchObject({
            sessionId: 's1',
            scopeId: 'session:s1',
            presentation: 'panel',
            initialIntent: 'review',
        });
        expect(screen.findAllByType('ActivityIndicator')).toHaveLength(0);
    });

    it('renders execution-run launcher tabs without an intermediate loading fallback', async () => {
        launcherViewSpy.mockClear();

        const SessionDetailsPanel = await getSessionDetailsPanel();
        const screen = await renderScreen(
            <SessionDetailsPanel sessionId="s1" scopeId="session:s1" />,
            { flushOptions: { cycles: 0 } },
        );

        expect(screen.findAllByType('ActivityIndicator')).toHaveLength(0);
        expect(launcherViewSpy).toHaveBeenCalledTimes(1);
    });
});
