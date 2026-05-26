import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionDetailsPanelCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Dimensions: { get: () => ({ width: 1200, height: 800, scale: 2, fontScale: 1 }) },
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    surface: '#fff',
                    surfaceHigh: '#f5f5f5',
                    divider: '#eee',
                    text: '#000',
                    textSecondary: '#666',
                    shadow: { color: '#000', opacity: 0.2 },
                    accent: {
                        indigo: '#5C6BC0',
                        orange: '#FF9500',
                    },
                },
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock();
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

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
        eyebrow: () => ({}),
        keyHint: () => ({}),
        mono: () => ({}),
    },
}));

vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({
    ActivitySpinner: (props: Record<string, unknown>) => React.createElement('ActivitySpinner', props),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: Record<string, unknown>) => React.createElement('Text', props),
}));

vi.mock('@/components/ui/media/FileIcon', () => ({
    FileIcon: (props: Record<string, unknown>) => React.createElement('FileIcon', props),
}));

vi.mock('@/utils/platform/deferOnWeb', () => ({
    deferOnWeb: (fn: () => void) => fn(),
}));

vi.mock('@/utils/ui/toTestIdSafeValue', () => ({
    toTestIdSafeValue: (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_'),
}));

vi.mock('@/components/sessions/files/views/SessionFileDetailsView', () => ({
    SessionFileDetailsView: () => React.createElement('SessionFileDetailsView'),
}));

vi.mock('@/components/sessions/files/views/SessionCommitDetailsView', () => ({
    SessionCommitDetailsView: () => React.createElement('SessionCommitDetailsView'),
}));

vi.mock('@/components/sessions/files/views/SessionScmReviewDetailsView', () => ({
    SessionScmReviewDetailsView: () => React.createElement('SessionScmReviewDetailsView'),
}));

vi.mock('@/components/sessions/terminal/SessionEmbeddedTerminalPane', () => ({
    SessionEmbeddedTerminalPane: () => React.createElement('SessionEmbeddedTerminalPane'),
}));

vi.mock('@/agents/registry/sessionSubagentUiBehavior', () => ({
    renderProviderSessionDetailsTab: () => null,
    resolveProviderSessionDetailsTabIconName: () => null,
}));

vi.mock('@/components/sessions/runs/launcher/SessionExecutionRunLauncherView', () => ({
    SessionExecutionRunLauncherView: () => React.createElement('SessionExecutionRunLauncherView'),
}));

vi.mock('@/components/sessions/devPreview/SessionLocalServicePreviewPane', () => ({
    SessionLocalServicePreviewPane: () => React.createElement('SessionLocalServicePreviewPane'),
}));

vi.mock('@/components/sessions/shell/sessionPinIcons', () => ({
    PinIcon: (props: Record<string, unknown>) => React.createElement('PinIcon', props),
    PinSlashIcon: (props: Record<string, unknown>) => React.createElement('PinSlashIcon', props),
}));

vi.mock('@/components/appShell/panes/focusMode/usePaneFocusMode', () => ({
    usePaneFocusMode: () => ({
        active: false,
        canEnter: false,
        toggle: vi.fn(),
    }),
}));

vi.mock('@/components/ui/scroll/useWebScrollLockBypass', () => ({
    useWebScrollLockBypass: () => ({ ref: { current: null } }),
}));

vi.mock('@/components/ui/scroll/resolveWebScrollableElement', () => ({
    resolveWebScrollableElementWithin: () => null,
}));

vi.mock('./SessionDetailsPanelDetailViews', () => ({
    SessionCommitDetailsViewForPanel: () => React.createElement('SessionCommitDetailsViewForPanel'),
    SessionFileDetailsViewForPanel: () => React.createElement('SessionFileDetailsViewForPanel'),
    SessionScmReviewDetailsViewForPanel: () => React.createElement('SessionScmReviewDetailsViewForPanel'),
    SessionScmStashDetailsViewForPanel: () => React.createElement('SessionScmStashDetailsViewForPanel'),
    SessionSubagentDetailsViewForPanel: () => React.createElement('SessionSubagentDetailsViewForPanel'),
}));

let mockAppPaneScope: any = null;
vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => mockAppPaneScope,
}));

describe('SessionDetailsPanel (close tab)', () => {
    it('closes a tab exactly once when clicking its close button', async () => {
        const closeDetailsTabSpy = vi.fn();

        mockAppPaneScope = {
            closeDetails: vi.fn(),
            closeDetailsTab: closeDetailsTabSpy,
            pinDetailsTab: vi.fn(),
            setActiveDetailsTab: vi.fn(),
            scopeState: {
                details: {
                    isOpen: true,
                    activeTabKey: 'file:a',
                    tabs: [
                        { key: 'file:a', kind: 'file', title: 'a.txt', isPinned: true, isPreview: false, resource: { kind: 'file', path: 'a.txt' } },
                    ],
                },
            },
        };

        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');
        let tree!: renderer.ReactTestRenderer;
        await act(async () => {
            tree = renderer.create(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);
        });
        const closeButton = tree.root.findByProps({ testID: 'session-details-tab-close-file_a' });
        await act(async () => {
            closeButton.props.onPress({ stopPropagation: vi.fn() });
        });
        await act(async () => {
            tree.unmount();
        });

        expect(closeDetailsTabSpy).toHaveBeenCalledTimes(1);
        expect(closeDetailsTabSpy).toHaveBeenCalledWith('file:a');
    });
});
