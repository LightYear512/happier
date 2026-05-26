import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import {
    installSessionActionsCommonModuleMocks,
    resetSessionActionsCommonModuleMockState,
} from './sessionActionsTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionActionsCommonModuleMocks();

const openDetailsTab = vi.fn();
const setActiveDetailsTab = vi.fn();

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        openDetailsTab,
        setActiveDetailsTab,
    }),
}));

const preview = {
    resourceId: 'preview_1',
    sessionId: 's1',
    machineId: 'machine-1',
    port: 5173,
    name: 'Preview app',
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
} as const;

const secondPreview = {
    ...preview,
    resourceId: 'preview_2',
    port: 3000,
    name: 'Docs app',
    registeredAtMs: 2,
    preview: {
        ...preview.preview,
        routeKey: 'route_2',
        initialPath: '/docs',
    },
} as const;

describe('SessionHeaderDevPreviewButton', () => {
    beforeEach(() => {
        resetSessionActionsCommonModuleMockState();
        openDetailsTab.mockClear();
        setActiveDetailsTab.mockClear();
    });

    it('opens the latest local service preview details tab from the session header', async () => {
        const { SessionHeaderDevPreviewButton } = await import('./SessionHeaderDevPreviewButton');

        const screen = await renderScreen(
            <SessionHeaderDevPreviewButton scopeId="session:s1" previews={[preview]} />,
        );

        expect(screen.findByTestId('session-header-dev-preview-button')).toBeTruthy();
        await screen.pressByTestIdAsync('session-header-dev-preview-button');

        expect(openDetailsTab).toHaveBeenCalledWith(
            expect.objectContaining({
                key: 'localServicePreview:preview_1',
                kind: 'localServicePreview',
                resource: expect.objectContaining({
                    kind: 'localServicePreview',
                    resourceId: 'preview_1',
                    initialPath: '/dashboard',
                }),
            }),
            { intent: 'preview' },
        );
    });

    it('hides the header preview button when no preview has been registered', async () => {
        const { SessionHeaderDevPreviewButton } = await import('./SessionHeaderDevPreviewButton');

        const screen = await renderScreen(
            <SessionHeaderDevPreviewButton scopeId="session:s1" previews={[]} />,
        );

        expect(screen.findByTestId('session-header-dev-preview-button')).toBeNull();
    });

    it('opens all registered previews as details tabs from the session header', async () => {
        const { SessionHeaderDevPreviewButton } = await import('./SessionHeaderDevPreviewButton');

        const screen = await renderScreen(
            <SessionHeaderDevPreviewButton scopeId="session:s1" previews={[secondPreview, preview]} />,
        );

        await screen.pressByTestIdAsync('session-header-dev-preview-button');

        expect(screen.findAllByType('DropdownMenu' as React.ElementType)).toHaveLength(0);
        expect(openDetailsTab).toHaveBeenCalledTimes(2);
        expect(openDetailsTab).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                key: 'localServicePreview:preview_2',
                kind: 'localServicePreview',
                resource: expect.objectContaining({
                    resourceId: 'preview_2',
                    initialPath: '/docs',
                }),
            }),
            { intent: 'preview' },
        );
        expect(openDetailsTab).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                key: 'localServicePreview:preview_1',
                kind: 'localServicePreview',
                resource: expect.objectContaining({
                    resourceId: 'preview_1',
                    initialPath: '/dashboard',
                }),
            }),
            { intent: 'preview' },
        );
        expect(setActiveDetailsTab).toHaveBeenCalledWith('localServicePreview:preview_2');
    });
});
