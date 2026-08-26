import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionDetailsPanelCommonModuleMocks({
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

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
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

vi.mock('@/constants/Typography', () => ({
    FontWeights: {
        regular: '400',
    },
    Typography: { default: () => ({}) },
}));

const terminalViewSpy = vi.fn();
vi.mock('@/components/sessions/terminal/SessionEmbeddedTerminalPane', () => ({
    SessionEmbeddedTerminalPane: (props: any) => {
        terminalViewSpy(props);
        return React.createElement('SessionEmbeddedTerminalPane');
    },
}));

vi.mock('@/components/sessions/runs/launcher/SessionExecutionRunLauncherView', () => ({
    SessionExecutionRunLauncherView: (props: any) => React.createElement('SessionExecutionRunLauncherView', props),
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

vi.mock('./SessionDetailsPanelDetailViews', () => ({
    SessionCommitDetailsViewForPanel: (props: any) => React.createElement('SessionCommitDetailsViewForPanel', props),
    SessionFileDetailsViewForPanel: (props: any) => React.createElement('SessionFileDetailsViewForPanel', props),
    SessionScmReviewDetailsViewForPanel: (props: any) => React.createElement('SessionScmReviewDetailsViewForPanel', props),
    SessionScmStashDetailsViewForPanel: (props: any) => React.createElement('SessionScmStashDetailsViewForPanel', props),
    SessionSubagentDetailsViewForPanel: (props: any) => React.createElement('SessionSubagentDetailsViewForPanel', props),
    SessionTranscriptDetailsViewForPanel: (props: any) => React.createElement('SessionTranscriptDetailsViewForPanel', props),
}));

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        closeDetails: vi.fn(),
        closeDetailsTab: vi.fn(),
        pinDetailsTab: vi.fn(),
        setActiveDetailsTab: vi.fn(),
        scopeState: {
            details: {
                isOpen: true,
                activeTabKey: 'terminal:embedded',
                tabs: [
                    {
                        key: 'terminal:embedded',
                        kind: 'terminal',
                        title: 'Terminal',
                        isPinned: true,
                        isPreview: false,
                        resource: { kind: 'terminal' },
                    },
                ],
            },
        },
    }),
}));

describe('SessionDetailsPanel (terminal resource)', () => {
    it('renders SessionEmbeddedTerminalPane for terminal tabs', async () => {
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');
        terminalViewSpy.mockClear();

        const screen = await renderScreen(
            <SessionDetailsPanel sessionId="s1" scopeId="session:s1" />,
            { flushOptions: { cycles: 0 } },
        );

        expect(terminalViewSpy).toHaveBeenCalledTimes(1);
        expect(terminalViewSpy.mock.calls[0]?.[0]?.sessionId).toBe('s1');
        expect(terminalViewSpy.mock.calls[0]?.[0]?.currentDockLocation).toBe('details');
        expect(screen.findAllByType('ActivityIndicator')).toHaveLength(0);
    });
});
