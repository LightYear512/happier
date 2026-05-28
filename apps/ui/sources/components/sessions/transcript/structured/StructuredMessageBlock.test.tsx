import React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { StructuredMessageBlock } from './StructuredMessageBlock';
import { renderScreen } from '@/dev/testkit';

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        openDetailsTab: vi.fn(),
    }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

describe('StructuredMessageBlock', () => {
    it('returns null for unknown kinds', async () => {
        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<StructuredMessageBlock
                    message={{ meta: { happier: { kind: 'unknown.v1', payload: {} } } } as any}
                    sessionId="s1"
                    onJumpToAnchor={() => {}}
                />)).tree;
        expect(tree!.toJSON()).toBeNull();
    });

    it('renders review comments card for valid payload', async () => {
        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<StructuredMessageBlock
                    message={{
                        meta: {
                            happier: {
                                kind: 'review_comments.v1',
                                payload: {
                                    sessionId: 's1',
                                    comments: [
                                        {
                                            id: 'c1',
                                            filePath: 'src/a.ts',
                                            source: 'file',
                                            anchor: { kind: 'fileLine', startLine: 1 },
                                            snapshot: { selectedLines: ['x'], beforeContext: [], afterContext: [] },
                                            body: 'nit',
                                            createdAt: 1,
                                        },
                                    ],
                                },
                            },
                        },
                    } as any}
                    sessionId="s1"
                    onJumpToAnchor={() => {}}
                />)).tree;

        const serialized = JSON.stringify(tree!.toJSON());
        expect(serialized).toContain('Review comments');
        expect(serialized).toContain('src/a.ts');
    });

    it('renders participant message card for valid payload', async () => {
        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<StructuredMessageBlock
                    message={{
                        kind: 'user-text',
                        id: 'm1',
                        localId: null,
                        createdAt: 1,
                        text: 'hello there',
                        meta: {
                            happier: {
                                kind: 'participant_message.v1',
                                payload: {
                                    recipient: {
                                        kind: 'agent_team_member',
                                        teamId: 'team_1',
                                        memberId: 'agent_1',
                                        memberLabel: 'Alice',
                                    },
                                },
                            },
                        },
                    } as any}
                    sessionId="s1"
                    onJumpToAnchor={() => {}}
                />)).tree;

        const serialized = JSON.stringify(tree!.toJSON());
        expect(serialized).toContain('To:');
        expect(serialized).toContain('Alice');
        expect(serialized).toContain('hello there');

        const findTextNode = (text: string) =>
            tree!.findAll((n: any) => n.type === 'Text' && n.props?.children === text)[0]!;
        expect(findTextNode('hello there').props.selectable).toBe(true);
    });

    it('renders subagent launch card for valid payload', async () => {
        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<StructuredMessageBlock
                    message={{
                        kind: 'user-text',
                        id: 'm_launch',
                        localId: null,
                        createdAt: 1,
                        text: 'Launch the alpha teammate',
                        meta: {
                            happier: {
                                kind: 'subagent_launch.v1',
                                payload: {
                                    kind: 'agent_team_member_create',
                                    teamId: 'team_1',
                                    memberLabel: 'alpha',
                                    instructions: 'Handle the linting lane',
                                    runInBackground: true,
                                },
                            },
                        },
                    } as any}
                    sessionId="s1"
                    onJumpToAnchor={() => {}}
                />)).tree;

        const serialized = JSON.stringify(tree!.toJSON());
        expect(serialized).toContain('alpha');
        expect(serialized).toContain('Launch the alpha teammate');
    });

    it('renders subagent command card for valid payload', async () => {
        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<StructuredMessageBlock
                    message={{
                        kind: 'user-text',
                        id: 'm_command',
                        localId: null,
                        createdAt: 1,
                        text: 'Shut alpha down',
                        meta: {
                            happier: {
                                kind: 'subagent_command.v1',
                                payload: {
                                    kind: 'agent_team_member_delete',
                                    teamId: 'team_1',
                                    memberId: 'alpha@team_1',
                                    memberLabel: 'alpha',
                                },
                            },
                        },
                    } as any}
                    sessionId="s1"
                    onJumpToAnchor={() => {}}
                />)).tree;

        const serialized = JSON.stringify(tree!.toJSON());
        expect(serialized).toContain('alpha');
        expect(serialized).toContain('Shut alpha down');
    });

    it('renders local service preview card for valid payload', async () => {
        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<StructuredMessageBlock
                    message={{
                        kind: 'user-text',
                        id: 'm_preview',
                        localId: null,
                        createdAt: 1,
                        text: 'preview',
                        meta: {
                            happier: {
                                kind: 'local_service_preview.v1',
                                payload: {
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
                                    },
                                },
                            },
                        },
                    } as any}
                    sessionId="s1"
                    onJumpToAnchor={() => {}}
                />)).tree;

        const serialized = JSON.stringify(tree!.toJSON());
        expect(serialized).toContain('Preview app');
        expect(serialized).toContain('3000');
        expect(serialized).toContain('ready');
    });

    it('renders simulator preview card for valid payload', async () => {
        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<StructuredMessageBlock
                    message={{
                        kind: 'user-text',
                        id: 'm_simulator_preview',
                        localId: null,
                        createdAt: 1,
                        text: 'simulator',
                        meta: {
                            happier: {
                                kind: 'simulator_preview.v1',
                                payload: {
                                    simulatorSessionId: 'sim_1',
                                    sessionId: 's1',
                                    platform: 'ios',
                                    deviceName: 'iPhone 15',
                                    appName: 'Happier',
                                    streamUrl: 'https://relay.example.test/simulator/sim_1/frame.jpg',
                                    mode: 'user_control',
                                    owner: 'user',
                                    connectionPath: 'relay',
                                    registeredAtMs: 1,
                                },
                            },
                        },
                    } as any}
                    sessionId="s1"
                    onJumpToAnchor={() => {}}
                />)).tree;

        const serialized = JSON.stringify(tree!.toJSON());
        expect(serialized).toContain('iPhone 15');
        expect(serialized).toContain('Happier');
    });
});
