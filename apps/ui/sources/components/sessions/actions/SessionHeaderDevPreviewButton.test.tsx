import * as React from 'react';
import { act } from 'react';
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
const closeDetailsTab = vi.fn();
const actionExecute = vi.fn(async () => ({ ok: true, result: { ok: true, closed: true, preview: null } }));

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        openDetailsTab,
        setActiveDetailsTab,
        closeDetailsTab,
    }),
}));

vi.mock('@/sync/ops/actions/defaultActionExecutor', () => ({
    createDefaultActionExecutor: () => ({
        execute: actionExecute,
    }),
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement('DropdownMenu', props, props.trigger?.({
        open: props.open,
        toggle: () => props.onOpenChange(!props.open),
        openMenu: () => props.onOpenChange(true),
        closeMenu: () => props.onOpenChange(false),
        selectedItem: null,
    })),
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
        closeDetailsTab.mockClear();
        actionExecute.mockClear();
    });

    it('opens a lightweight menu instead of directly opening the latest preview', async () => {
        const { SessionHeaderDevPreviewButton } = await import('./SessionHeaderDevPreviewButton');

        const screen = await renderScreen(
            <SessionHeaderDevPreviewButton scopeId="session:s1" previews={[preview]} />,
        );

        expect(screen.findByTestId('session-header-dev-preview-button')).toBeTruthy();
        await screen.pressByTestIdAsync('session-header-dev-preview-button');

        const dropdown = screen.findByType('DropdownMenu' as React.ElementType);
        expect(dropdown.props.open).toBe(true);
        expect(dropdown.props.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'open:preview_1', title: 'Preview app' }),
            expect.objectContaining({ id: 'stop:preview_1' }),
        ]));
        expect(openDetailsTab).not.toHaveBeenCalled();

        act(() => {
            dropdown.props.onSelect('open:preview_1');
        });
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

    it('shows the same lightweight menu for multiple previews', async () => {
        const { SessionHeaderDevPreviewButton } = await import('./SessionHeaderDevPreviewButton');

        const screen = await renderScreen(
            <SessionHeaderDevPreviewButton scopeId="session:s1" previews={[secondPreview, preview]} />,
        );

        await screen.pressByTestIdAsync('session-header-dev-preview-button');

        const dropdown = screen.findByType('DropdownMenu' as React.ElementType);
        expect(dropdown.props.open).toBe(true);
        expect(dropdown.props.items.map((item: any) => item.id)).toEqual([
            'open:preview_2',
            'stop:preview_2',
            'open:preview_1',
            'stop:preview_1',
        ]);
        expect(openDetailsTab).not.toHaveBeenCalled();
        expect(setActiveDetailsTab).not.toHaveBeenCalled();
    });

    it('stops a preview from the menu and closes the corresponding details tab', async () => {
        const { SessionHeaderDevPreviewButton } = await import('./SessionHeaderDevPreviewButton');

        const screen = await renderScreen(
            <SessionHeaderDevPreviewButton scopeId="session:s1" previews={[preview]} />,
        );

        await screen.pressByTestIdAsync('session-header-dev-preview-button');
        const dropdown = screen.findByType('DropdownMenu' as React.ElementType);
        await act(async () => {
            await dropdown.props.onSelect('stop:preview_1');
        });

        expect(actionExecute).toHaveBeenCalledWith(
            'session.devPreview.close',
            { sessionId: 's1', resourceId: 'preview_1' },
            { surface: 'ui_button', defaultSessionId: 's1' },
        );
        expect(closeDetailsTab).toHaveBeenCalledWith('localServicePreview:preview_1');
    });
});
