import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = vi.hoisted(() => ({
    persistedDraft: null as Record<string, unknown> | null,
    tempData: null as Record<string, unknown> | null,
    serverId: 's1',
    resolvedTargetServerId: undefined as string | null | undefined,
    localSearchParams: { dataId: 'draft-data-id' } as Record<string, string>,
    serverListeners: new Set<() => void>(),
}));

function setMockServerId(serverId: string): void {
    mockState.serverId = serverId;
    for (const listener of mockState.serverListeners) {
        listener();
    }
}

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ View: 'View' });
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ params: mockState.localSearchParams }).module;
});

vi.mock('@/components/sessions/guidance/SessionGettingStartedGuidance', () => ({
    SessionGettingStartedGuidance: 'SessionGettingStartedGuidance',
    useSessionGettingStartedGuidanceBaseModel: () => {
        const serverId = React.useSyncExternalStore(
            (listener) => {
                mockState.serverListeners.add(listener);
                return () => {
                    mockState.serverListeners.delete(listener);
                };
            },
            () => mockState.serverId,
            () => mockState.serverId
        );

        return {
            kind: 'connect_machine',
            targetLabel: 'Test server',
            serverId,
            serverName: 'Test',
            serverUrl: 'https://api.happier.dev',
            showServerSetup: false,
        };
    },
}));

vi.mock('@/sync/store/hooks', () => ({
    useSettings: () => ({
        serverSelectionGroups: [],
        serverSelectionActiveTargetKind: 'server',
        serverSelectionActiveTargetId: mockState.serverId,
    }),
    useActiveServerAccountScope: () => ({
        serverId: mockState.serverId,
        accountId: 'account-1',
    }),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({
        serverId: mockState.serverId,
        serverUrl: 'https://api.happier.dev',
        generation: 1,
    }),
    subscribeActiveServer: (listener: (snapshot: { serverId: string; serverUrl: string; generation: number }) => void) => {
        const wrapped = () => {
            listener({
                serverId: mockState.serverId,
                serverUrl: 'https://api.happier.dev',
                generation: 1,
            });
        };
        mockState.serverListeners.add(wrapped);
        return () => {
            mockState.serverListeners.delete(wrapped);
        };
    },
}));

vi.mock('@/components/sessions/new/hooks/serverTarget/useNewSessionServerTargetState', () => ({
    useNewSessionServerTargetState: ({ request }: { request?: { spawnServerIdParam?: string | null } }) => ({
        targetServerId:
            typeof request?.spawnServerIdParam === 'string'
                ? request.spawnServerIdParam
                : mockState.resolvedTargetServerId === undefined
                    ? mockState.serverId
                    : mockState.resolvedTargetServerId,
    }),
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const expoRouterMock = createExpoRouterMock({
        params: mockState.localSearchParams,
    });
    return expoRouterMock.module;
});

vi.mock('@/sync/domains/state/persistence', async (importOriginal) => {
    const actual = await importOriginal() as typeof import('@/sync/domains/state/persistence');
    return {
        ...actual,
        loadNewSessionDraft: () => {
            if (!mockState.persistedDraft) {
                return null;
            }
            return mockState.persistedDraft;
        },
    };
});

vi.mock('@/utils/sessions/tempDataStore', () => ({
    peekTempData: () => mockState.tempData,
}));

vi.mock('@/components/sessions/new/hooks/useNewSessionScreenModel', () => ({
    useNewSessionScreenModel: () => ({
        variant: 'wizard',
        popoverBoundaryRef: { current: null },
        wizardProps: {
            layout: null,
            sectionPresentation: null,
            profiles: null,
            agent: null,
            machine: null,
            footer: null,
        },
    }),
}));

vi.mock('@/components/sessions/new/navigation/newSessionContainedModalScreen', () => ({
    NewSessionScreenPortalScope: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/sessions/new/components/NewSessionSimplePanel', () => ({
    NewSessionSimplePanel: 'NewSessionSimplePanel',
}));

vi.mock('@/components/sessions/new/components/NewSessionWizard', () => ({
    NewSessionWizard: 'NewSessionWizard',
}));

vi.mock('@/components/ui/popover', async (importOriginal) => {
    const actual = await importOriginal() as typeof import('@/components/ui/popover');
    return {
        ...actual,
        PopoverBoundaryProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
        PopoverPortalTargetProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
        PopoverScope: ({ children }: any) => React.createElement(React.Fragment, null, children),
    };
});

afterEach(() => {
    mockState.persistedDraft = null;
    mockState.tempData = null;
    mockState.serverListeners.clear();
    mockState.serverId = 's1';
    mockState.resolvedTargetServerId = undefined;
    mockState.localSearchParams = { dataId: 'draft-data-id' };
});

describe('/new (blocking guidance)', () => {
    it('hard-stops with connect-machine guidance when no machines exist', async () => {
        setMockServerId('s1');

        const Screen = (await import('@/app/(app)/new')).default;
        const screen = await renderScreen(React.createElement(Screen));

        expect(() => screen.findByType('SessionGettingStartedGuidance')).not.toThrow();
        expect(() => screen.findByType('NewSessionWizard')).toThrow();
    });

    it('keeps the wizard path when temp data seeds a worktree draft intent', async () => {
        setMockServerId('s1');
        mockState.tempData = {
            workspaceId: 'workspace-1',
            workspaceLocationId: 'location-1',
            checkoutCreationDraft: {
                kind: 'git_worktree',
                displayName: 'feature-x',
                baseRef: 'main',
            },
        };

        const Screen = (await import('@/app/(app)/new')).default;
        const screen = await renderScreen(React.createElement(Screen));

        expect(() => screen.findByType('NewSessionWizard')).not.toThrow();
        expect(() => screen.findByType('SessionGettingStartedGuidance')).toThrow();
    });
});
