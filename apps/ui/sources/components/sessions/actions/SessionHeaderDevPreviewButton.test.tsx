import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import {
    installSessionActionsCommonModuleMocks,
    resetSessionActionsCommonModuleMockState,
} from './sessionActionsTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionActionsCommonModuleMocks();

const openDetailsTab = vi.fn();

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: Readonly<{
        open: boolean;
        onOpenChange: (next: boolean) => void;
        trigger?: ((props: Readonly<{
            open: boolean;
            toggle: () => void;
            openMenu: () => void;
            closeMenu: () => void;
            selectedItem: null;
        }>) => React.ReactNode) | React.ReactNode;
        items: ReadonlyArray<unknown>;
        onSelect: (itemId: string) => void;
    }>) => {
        const trigger = typeof props.trigger === 'function'
            ? props.trigger({
                open: props.open,
                toggle: () => props.onOpenChange(!props.open),
                openMenu: () => props.onOpenChange(true),
                closeMenu: () => props.onOpenChange(false),
                selectedItem: null,
            })
            : props.trigger;
        return React.createElement('DropdownMenu', props, trigger);
    },
}));

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        openDetailsTab,
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

    it('opens a preview picker when more than one preview has been registered', async () => {
        const { SessionHeaderDevPreviewButton } = await import('./SessionHeaderDevPreviewButton');

        const screen = await renderScreen(
            <SessionHeaderDevPreviewButton scopeId="session:s1" previews={[secondPreview, preview]} />,
        );

        await screen.pressByTestIdAsync('session-header-dev-preview-button');

        const dropdown = screen.findByType('DropdownMenu' as React.ElementType);
        expect(dropdown.props.open).toBe(true);
        expect(dropdown.props.items).toEqual([
            expect.objectContaining({
                id: 'preview_2',
                testID: 'session-header-dev-preview-menu-item-preview_2',
                title: 'Docs app',
                subtitle: '127.0.0.1:3000/docs',
            }),
            expect.objectContaining({
                id: 'preview_1',
                testID: 'session-header-dev-preview-menu-item-preview_1',
                title: 'Preview app',
                subtitle: '127.0.0.1:5173/dashboard',
            }),
        ]);

        await act(async () => {
            dropdown.props.onSelect('preview_1');
        });

        expect(openDetailsTab).toHaveBeenCalledWith(
            expect.objectContaining({
                key: 'localServicePreview:preview_1',
                kind: 'localServicePreview',
                resource: expect.objectContaining({
                    resourceId: 'preview_1',
                }),
            }),
            { intent: 'preview' },
        );
    });
});
