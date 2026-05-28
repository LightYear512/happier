import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));

vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}) },
}));

installSessionDetailsPanelCommonModuleMocks({
    icons: async () => ({
        Octicons: 'Octicons',
        Ionicons: 'Ionicons',
    }),
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
                activeTabKey: 'simulatorPreview:sim_1',
                tabState: {},
                tabs: [
                    {
                        key: 'simulatorPreview:sim_1',
                        kind: 'simulatorPreview',
                        title: 'Pixel 8',
                        isPinned: false,
                        isPreview: true,
                        resource: {
                            kind: 'simulatorPreview',
                            simulatorSessionId: 'sim_1',
                            platform: 'android',
                            deviceName: 'Pixel 8',
                            appName: 'Happier',
                            streamUrl: 'https://relay.example.test/simulator/sim_1/frame.jpg',
                            mode: 'user_control',
                            owner: 'user',
                            connectionPath: 'relay',
                        },
                    },
                ],
            },
        },
    }),
}));

vi.mock('@/components/sessions/terminal/SessionEmbeddedTerminalPane', () => ({
    SessionEmbeddedTerminalPane: () => React.createElement('SessionEmbeddedTerminalPane'),
}));

vi.mock('@/components/sessions/files/views/SessionCommitDetailsView', () => ({
    SessionCommitDetailsView: () => React.createElement('SessionCommitDetailsView'),
}));

vi.mock('@/components/sessions/files/views/SessionFileDetailsView', () => ({
    SessionFileDetailsView: () => React.createElement('SessionFileDetailsView'),
}));

describe('SessionDetailsPanel (simulator preview)', () => {
    it('renders the simulator frame inside a details tab', async () => {
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');
        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);

        const frame = screen.findByProps({ 'data-testid': 'session.simulatorPreview.frame' });

        expect(frame.props.src).toBe('https://relay.example.test/simulator/sim_1/frame.jpg');
        expect(screen.findByProps({ testID: 'session.simulatorPreview.surface' })).toBeTruthy();
    });
});
