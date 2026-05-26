import * as React from 'react';

import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalServicePreviewV1 } from '@happier-dev/protocol';

import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { SessionCockpitSurfaceNavigationProvider } from './SessionCockpitSurfaceNavigation';
import {
    SessionCockpitSurfaceScreen,
    type SessionCockpitSurfaceScreenProps,
} from './SessionCockpitSurfaceScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerPushSpy = vi.hoisted(() => vi.fn());
const pathnameState = vi.hoisted(() => ({
    pathname: '/session/s_1/git',
}));
const safeAreaInsetsMock = vi.hoisted(() => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
}));
const navigationFocusState = vi.hoisted(() => ({
    isFocused: true,
}));
const bottomTabsState = vi.hoisted(() => ({
    navigations: [] as string[],
}));
const sessionMessagesState = vi.hoisted(() => ({
    messages: [] as Message[],
}));
const sessionState = vi.hoisted(() => ({
    metadata: null as Record<string, unknown> | null,
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        pathname: () => pathnameState.pathname,
        router: {
            push: routerPushSpy,
        },
    }).module;
});

vi.mock('@react-navigation/native', () => ({
    useIsFocused: () => navigationFocusState.isFocused,
}));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => safeAreaInsetsMock,
}));

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useLocalSetting: () => null,
        useSession: () => ({ id: 's_1', metadata: sessionState.metadata }),
        useSessionMessages: () => ({ messages: sessionMessagesState.messages, isLoaded: true }),
    });
});

vi.mock('@/components/sessions/shell/SessionView', () => ({
    SessionView: (props: Record<string, unknown> & { contentOverride?: React.ReactNode }) => React.createElement(
        'SessionView',
        props,
        props.contentOverride ?? null,
    ),
}));

vi.mock('@/components/sessions/panes/SessionDetailsPanel', () => ({
    SessionDetailsPanel: (props: Record<string, unknown>) => React.createElement('SessionDetailsPanel', props),
}));

vi.mock('@/components/sessions/devPreview/SessionLocalServicePreviewPane', () => ({
    SessionLocalServicePreviewPane: (props: Record<string, unknown>) => React.createElement(
        'SessionLocalServicePreviewPane',
        props,
    ),
}));

vi.mock('@/components/sessions/panes/surfaces/SessionBrowseFilesSurface', () => ({
    SessionBrowseFilesSurface: (props: Record<string, unknown>) => React.createElement('SessionBrowseFilesSurface', props),
}));

vi.mock('@/components/sessions/panes/surfaces/SessionGitSurface', () => ({
    SessionGitSurface: (props: Record<string, unknown>) => React.createElement('SessionGitSurface', props),
}));

vi.mock('@/components/sessions/panes/surfaces/SessionTerminalSurface', () => ({
    SessionTerminalSurface: (props: Record<string, unknown>) => React.createElement('SessionTerminalSurface', props),
}));

vi.mock('@/components/navigation/mobile/chrome/bars/SessionCockpitTabBar', () => ({
    SessionCockpitTabBar: (props: Record<string, unknown>) => React.createElement('SessionCockpitTabBar', props),
}));

function PaneScopeProbe(props: Readonly<{ scopeId: string }>) {
    const pane = useAppPaneScope(props.scopeId);

    return React.createElement('PaneScopeProbe', {
        scopeState: pane.scopeState,
    });
}

function DeepLinkDetailsProbe(props: Readonly<{ scopeId: string; path: string }>) {
    const pane = useAppPaneScope(props.scopeId);
    const openedRef = React.useRef(false);

    React.useEffect(() => {
        if (openedRef.current) {
            return;
        }
        openedRef.current = true;
        pane.openDetailsTab({
            key: `file:${props.path}`,
            kind: 'file',
            title: props.path,
            resource: { path: props.path },
        });
    }, [pane, props.path]);

    return null;
}

function createPreviewPayload(overrides: Partial<LocalServicePreviewV1> = {}): LocalServicePreviewV1 {
    return {
        resourceId: 'preview_1',
        sessionId: 's_1',
        machineId: 'machine_1',
        port: 5173,
        origin: 'http://127.0.0.1:5173',
        url: 'http://127.0.0.1:5173/ai-console/develop/',
        name: 'layaideamanagementpage',
        framework: 'vite',
        source: 'mcp_tool',
        registeredAtMs: 1,
        health: { status: 'ready', checkedAtMs: 2 },
        preview: {
            rewriteUrls: true,
            supportsWebSocket: true,
            routeKey: 'route_1',
            initialPath: '/ai-console/develop/',
        },
        ...overrides,
    };
}

function createPreviewMessage(payload: LocalServicePreviewV1): Message {
    return {
        kind: 'agent-text',
        id: `message_${payload.resourceId}`,
        localId: null,
        createdAt: payload.registeredAtMs,
        text: '',
        meta: {
            happier: {
                kind: 'local_service_preview.v1',
                payload,
            },
        },
    };
}

function CockpitSurfaceHarness(props: SessionCockpitSurfaceScreenProps) {
    const [surface, setSurface] = React.useState(props.surface);
    React.useEffect(() => {
        setSurface(props.surface);
    }, [props.surface]);

    const switchSurface = React.useCallback((nextSurface: typeof surface) => {
        bottomTabsState.navigations.push(nextSurface);
        setSurface(nextSurface);
    }, []);

    return (
        <SessionCockpitSurfaceNavigationProvider value={{ switchSurface }}>
            <SessionCockpitSurfaceScreen {...props} surface={surface} />
        </SessionCockpitSurfaceNavigationProvider>
    );
}

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    }
    if (style && typeof style === 'object') {
        return style as Record<string, unknown>;
    }
    return {};
}

describe('SessionCockpitSurfaceScreen', () => {
    beforeEach(() => {
        standardCleanup();
        pathnameState.pathname = '/session/s_1/git';
        bottomTabsState.navigations = [];
        sessionMessagesState.messages = [];
        sessionState.metadata = null;
        navigationFocusState.isFocused = true;
        safeAreaInsetsMock.top = 0;
        safeAreaInsetsMock.bottom = 0;
        safeAreaInsetsMock.left = 0;
        safeAreaInsetsMock.right = 0;
        routerPushSpy.mockClear();
    });

    it('closes an already-open right pane when the chat surface becomes active', async () => {
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="terminal"
                    routeServerId="server-b"
                    terminalTabAvailable
                />
                <PaneScopeProbe scopeId="session:s_1" />
            </AppPaneProvider>,
        );

        await act(async () => {
            await screen.update(
                <AppPaneProvider>
                    <CockpitSurfaceHarness
                        sessionId="s_1"
                        scopeId="session:s_1"
                        surface="chat"
                        routeServerId="server-b"
                        terminalTabAvailable
                    />
                    <PaneScopeProbe scopeId="session:s_1" />
                </AppPaneProvider>,
            );
        });

        const probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.right).toEqual(expect.objectContaining({
            isOpen: false,
            activeTabId: 'terminal',
        }));
        const sessionView = screen.tree.findByType('SessionView' as never);
        expect(sessionView.props.id).toBe('s_1');
        expect(sessionView.props.routeServerId).toBe('server-b');
        expect(sessionView.props.routeAnchorOverride).toBe(true);
        expect(sessionView.props.chatBottomSpacing).toBe('none');
    });

    it('does not let an inactive chat surface close the active cockpit pane state', async () => {
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="terminal"
                    routeServerId="server-b"
                    terminalTabAvailable
                />
                <PaneScopeProbe scopeId="session:s_1" />
            </AppPaneProvider>,
        );

        let probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.right).toEqual(expect.objectContaining({
            isOpen: true,
            activeTabId: 'terminal',
        }));

        navigationFocusState.isFocused = false;
        await act(async () => {
            await screen.update(
                <AppPaneProvider>
                    <CockpitSurfaceHarness
                        sessionId="s_1"
                        scopeId="session:s_1"
                        surface="chat"
                        routeServerId="server-b"
                        terminalTabAvailable
                    />
                    <PaneScopeProbe scopeId="session:s_1" />
                </AppPaneProvider>,
            );
        });

        probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.right).toEqual(expect.objectContaining({
            isOpen: true,
            activeTabId: 'terminal',
        }));
    });

    it('reuses the session chrome for fullscreen cockpit surfaces', async () => {
        safeAreaInsetsMock.top = 24;
        safeAreaInsetsMock.bottom = 12;

        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="terminal"
                    routeServerId="server-b"
                    safeAreaPadding={false}
                    terminalTabAvailable
                />
            </AppPaneProvider>,
        );

        const sessionView = screen.tree.findByType('SessionView' as never);
        expect(sessionView.props.id).toBe('s_1');
        expect(sessionView.props.routeServerId).toBe('server-b');
        expect(sessionView.props.safeAreaTopMode).toBe('internal');
        expect(sessionView.props.headerSafeAreaTopMode).toBe('internal');

        const terminalScreen = screen.tree.findByProps({ testID: 'session-terminal-screen' } as never);
        expect(flattenStyle(terminalScreen.props.style)).toMatchObject({
            paddingTop: 0,
            paddingBottom: 0,
        });
    });

    it.each([
        ['browse', 'SessionBrowseFilesSurface'],
        ['git', 'SessionGitSurface'],
        ['terminal', 'SessionTerminalSurface'],
        ['tabs', 'SessionDetailsPanel'],
    ] as const)('renders the %s surface inside shared session chrome', async (surface, expectedType) => {
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface={surface}
                    routeServerId="server-b"
                    safeAreaPadding={false}
                    terminalTabAvailable
                />
            </AppPaneProvider>,
        );

        const sessionViews = screen.tree.findAllByType('SessionView' as never);
        expect(sessionViews).toHaveLength(1);
        expect(sessionViews[0]?.props.contentOverride).toBeTruthy();
        expect(screen.tree.findByType(expectedType as never)).toBeTruthy();
    });

    it('keeps git surface detail-opening callbacks stable across cockpit rerenders', async () => {
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="git"
                    routeServerId="server-b"
                    terminalTabAvailable
                />
            </AppPaneProvider>,
        );

        const firstGitSurface = screen.tree.findByType('SessionGitSurface' as never);
        const firstProps = { ...firstGitSurface.props };

        await act(async () => {
            await screen.update(
                <AppPaneProvider>
                    <CockpitSurfaceHarness
                        sessionId="s_1"
                        scopeId="session:s_1"
                        surface="git"
                        routeServerId="server-b"
                        jumpToSeq={42}
                        terminalTabAvailable
                    />
                </AppPaneProvider>,
            );
        });

        const nextGitSurface = screen.tree.findByType('SessionGitSurface' as never);
        expect(nextGitSurface.props.onOpenFile).toBe(firstProps.onOpenFile);
        expect(nextGitSurface.props.onOpenFilePinned).toBe(firstProps.onOpenFilePinned);
        expect(nextGitSurface.props.onOpenCommit).toBe(firstProps.onOpenCommit);
        expect(nextGitSurface.props.onOpenReviewAllChanges).toBe(firstProps.onOpenReviewAllChanges);
        expect(nextGitSurface.props.onOpenStashDetails).toBe(firstProps.onOpenStashDetails);
    });

    it('uses screen presentation for details when the route owns safe-area padding', async () => {
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="tabs"
                    safeAreaPadding={false}
                    terminalTabAvailable
                />
            </AppPaneProvider>,
        );

        const detailsPanel = screen.tree.findByType('SessionDetailsPanel' as never);
        expect(detailsPanel.props.presentation).toBe('screen');
        expect(detailsPanel.props.showHeaderActions).toBe(false);
    });

    it('opens file details on the internal details tab without pushing a sibling stack route', async () => {
        pathnameState.pathname = '/session/s_1/files';
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="browse"
                    routeServerId="server-b"
                    terminalTabAvailable
                />
                <PaneScopeProbe scopeId="session:s_1" />
            </AppPaneProvider>,
        );

        const browseSurface = screen.tree.findByType('SessionBrowseFilesSurface' as never);
        await act(async () => {
            browseSurface.props.onOpenFile('src/example.ts');
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(routerPushSpy).not.toHaveBeenCalled();
        expect(bottomTabsState.navigations).toContain('tabs');
        const probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.details).toEqual(expect.objectContaining({
            isOpen: true,
            activeTabKey: 'file:src/example.ts',
        }));
    });

    it('opens commit details on the internal details tab without pushing a sibling stack route', async () => {
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="git"
                    routeServerId="server-b"
                    terminalTabAvailable
                />
            </AppPaneProvider>,
        );

        const gitSurface = screen.tree.findByType('SessionGitSurface' as never);
        await act(async () => {
            gitSurface.props.onOpenCommit('abc1234 extra');
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(routerPushSpy).not.toHaveBeenCalled();
        expect(bottomTabsState.navigations).toContain('tabs');
    });

    it('opens review details on the internal details tab without pushing a sibling stack route', async () => {
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="git"
                    routeServerId="server-b"
                    terminalTabAvailable
                />
            </AppPaneProvider>,
        );

        const gitSurface = screen.tree.findByType('SessionGitSurface' as never);
        await act(async () => {
            gitSurface.props.onOpenReviewAllChanges();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(routerPushSpy).not.toHaveBeenCalled();
        expect(bottomTabsState.navigations).toContain('tabs');
    });

    it('closes the details presentation when returning to chat from an opened review', async () => {
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="git"
                    routeServerId="server-b"
                    terminalTabAvailable
                />
                <PaneScopeProbe scopeId="session:s_1" />
            </AppPaneProvider>,
        );

        const gitSurface = screen.tree.findByType('SessionGitSurface' as never);
        await act(async () => {
            gitSurface.props.onOpenReviewAllChanges();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        let probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.details).toEqual(expect.objectContaining({
            isOpen: true,
            activeTabKey: 'scmReview:working',
        }));

        await act(async () => {
            await screen.update(
                <AppPaneProvider>
                    <CockpitSurfaceHarness
                        sessionId="s_1"
                        scopeId="session:s_1"
                        surface="chat"
                        routeServerId="server-b"
                        terminalTabAvailable
                    />
                    <PaneScopeProbe scopeId="session:s_1" />
                </AppPaneProvider>,
            );
        });

        probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.details).toEqual(expect.objectContaining({
            isOpen: false,
            activeTabKey: 'scmReview:working',
        }));
        expect(probe.props.scopeState?.details?.tabs).toHaveLength(1);
    });

    it('keeps root-route deep-linked details open while the chat surface settles', async () => {
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="chat"
                    routeServerId="server-b"
                    paneUrlState={{
                        details: { kind: 'file', path: 'src/example.ts' },
                    }}
                    terminalTabAvailable
                />
                <DeepLinkDetailsProbe scopeId="session:s_1" path="src/example.ts" />
                <PaneScopeProbe scopeId="session:s_1" />
            </AppPaneProvider>,
        );

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.details).toEqual(expect.objectContaining({
            isOpen: true,
            activeTabKey: 'file:src/example.ts',
        }));
        expect(probe.props.scopeState?.details?.tabs).toHaveLength(1);
    });

    it('opens the latest local-service preview from a root-route details deep link', async () => {
        sessionMessagesState.messages = [createPreviewMessage(createPreviewPayload())];

        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="chat"
                    routeServerId="server-b"
                    paneUrlState={{
                        details: { kind: 'localServicePreview' },
                    }}
                    terminalTabAvailable
                />
                <PaneScopeProbe scopeId="session:s_1" />
            </AppPaneProvider>,
        );

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.details).toEqual(expect.objectContaining({
            isOpen: true,
            activeTabKey: 'localServicePreview:preview_1',
        }));
        expect(probe.props.scopeState?.details?.tabs[0]).toEqual(expect.objectContaining({
            key: 'localServicePreview:preview_1',
            kind: 'localServicePreview',
            title: 'layaideamanagementpage',
        }));
        expect(bottomTabsState.navigations).toContain('tabs');
    });

    it('opens a deep-linked local-service preview after preview messages load', async () => {
        const paneUrlState = {
            details: { kind: 'localServicePreview' as const },
        };
        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="chat"
                    routeServerId="server-b"
                    paneUrlState={paneUrlState}
                    terminalTabAvailable
                />
                <PaneScopeProbe scopeId="session:s_1" />
            </AppPaneProvider>,
        );

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        let probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.details).toBeUndefined();

        sessionMessagesState.messages = [createPreviewMessage(createPreviewPayload())];
        await act(async () => {
            await screen.update(
                <AppPaneProvider>
                    <CockpitSurfaceHarness
                        sessionId="s_1"
                        scopeId="session:s_1"
                        surface="chat"
                        routeServerId="server-b"
                        paneUrlState={paneUrlState}
                        terminalTabAvailable
                    />
                    <PaneScopeProbe scopeId="session:s_1" />
                </AppPaneProvider>,
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.details).toEqual(expect.objectContaining({
            isOpen: true,
            activeTabKey: 'localServicePreview:preview_1',
        }));
    });

    it('renders a route-targeted local-service preview on the tabs surface before pane state settles', async () => {
        sessionMessagesState.messages = [createPreviewMessage(createPreviewPayload())];
        navigationFocusState.isFocused = false;

        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="tabs"
                    routeServerId="server-b"
                    paneUrlState={{
                        details: { kind: 'localServicePreview', resourceId: 'preview_1' },
                    }}
                    terminalTabAvailable
                />
            </AppPaneProvider>,
        );

        const previewPane = screen.tree.findByType('SessionLocalServicePreviewPane' as never);
        expect(previewPane.props).toEqual(expect.objectContaining({
            resourceId: 'preview_1',
            sessionId: 's_1',
            machineId: 'machine_1',
            port: 5173,
            routeKey: 'route_1',
            initialPath: '/ai-console/develop/',
            rewriteUrls: true,
            supportsWebSocket: true,
            name: 'layaideamanagementpage',
            healthStatus: 'ready',
        }));
    });

    it('opens a deep-linked local-service preview from session metadata without transcript messages', async () => {
        sessionState.metadata = {
            localServicePreviewsV1: {
                v: 1,
                previews: [createPreviewPayload()],
            },
        };

        const screen = await renderScreen(
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="chat"
                    routeServerId="server-b"
                    paneUrlState={{
                        details: { kind: 'localServicePreview', resourceId: 'preview_1' },
                    }}
                    terminalTabAvailable
                />
                <PaneScopeProbe scopeId="session:s_1" />
            </AppPaneProvider>,
        );

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.details).toEqual(expect.objectContaining({
            isOpen: true,
            activeTabKey: 'localServicePreview:preview_1',
        }));
    });

    it('does not reopen the same deep-linked local-service preview on equivalent route rerenders', async () => {
        sessionMessagesState.messages = [createPreviewMessage(createPreviewPayload())];

        const renderHarness = () => (
            <AppPaneProvider>
                <CockpitSurfaceHarness
                    sessionId="s_1"
                    scopeId="session:s_1"
                    surface="chat"
                    routeServerId="server-b"
                    paneUrlState={{
                        details: { kind: 'localServicePreview', resourceId: 'preview_1' },
                    }}
                    terminalTabAvailable
                />
                <PaneScopeProbe scopeId="session:s_1" />
            </AppPaneProvider>
        );

        const screen = await renderScreen(renderHarness());

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        await act(async () => {
            await screen.update(renderHarness());
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(bottomTabsState.navigations.filter((surface) => surface === 'tabs')).toHaveLength(1);
        const probe = screen.tree.findByType('PaneScopeProbe' as never);
        expect(probe.props.scopeState?.details?.tabs).toHaveLength(1);
    });
});
