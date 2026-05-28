import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { SimulatorPreviewMessageCard } from './SimulatorPreviewMessageCard';

const openDetailsTab = vi.fn();

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        openDetailsTab,
    }),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

describe('SimulatorPreviewMessageCard', () => {
    it('opens a simulatorPreview details tab when pressed', async () => {
        openDetailsTab.mockClear();

        const screen = await renderScreen(
            <SimulatorPreviewMessageCard
                payload={{
                    simulatorSessionId: 'sim_1',
                    sessionId: 's1',
                    platform: 'android',
                    deviceName: 'Pixel 8',
                    appName: 'Happier',
                    streamUrl: 'https://relay.example.test/simulator/sim_1/frame.jpg',
                    mode: 'user_control',
                    owner: 'user',
                    connectionPath: 'relay',
                    registeredAtMs: 1,
                }}
                sessionId="s1"
            />,
        );

        await pressTestInstanceAsync(screen.root.findByProps({ testID: 'simulator-preview-card' }));

        expect(openDetailsTab).toHaveBeenCalledWith(
            expect.objectContaining({
                key: 'simulatorPreview:sim_1',
                kind: 'simulatorPreview',
                resource: expect.objectContaining({
                    kind: 'simulatorPreview',
                    simulatorSessionId: 'sim_1',
                    streamUrl: 'https://relay.example.test/simulator/sim_1/frame.jpg',
                }),
            }),
            { intent: 'preview' },
        );
    });
});
