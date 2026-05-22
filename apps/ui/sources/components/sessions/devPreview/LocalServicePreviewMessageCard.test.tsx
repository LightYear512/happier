import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';

import { LocalServicePreviewMessageCard } from './LocalServicePreviewMessageCard';

const openDetailsTab = vi.fn();

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        openDetailsTab,
    }),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

describe('LocalServicePreviewMessageCard', () => {
    it('opens a localServicePreview details tab when pressed', async () => {
        openDetailsTab.mockClear();

        const screen = await renderScreen(
            <LocalServicePreviewMessageCard
                payload={{
                    resourceId: 'preview_1',
                    sessionId: 's1',
                    machineId: 'machine-1',
                    port: 3000,
                    name: 'Preview app',
                    framework: 'vite',
                    source: 'mcp_tool',
                    registeredAtMs: 1,
                    health: {
                        status: 'ready',
                        checkedAtMs: 1,
                    },
                    preview: {
                        rewriteUrls: true,
                        supportsWebSocket: true,
                        routeKey: 'route_1',
                        initialPath: '/dashboard',
                    },
                }}
                sessionId="s1"
            />,
        );

        await pressTestInstanceAsync(screen.root.findByProps({ testID: 'local-service-preview-card' }));

        expect(openDetailsTab).toHaveBeenCalledWith(
            expect.objectContaining({
                key: 'localServicePreview:preview_1',
                kind: 'localServicePreview',
                resource: expect.objectContaining({
                    kind: 'localServicePreview',
                    resourceId: 'preview_1',
                    port: 3000,
                    routeKey: 'route_1',
                    initialPath: '/dashboard',
                }),
            }),
            { intent: 'preview' },
        );
    });
});
