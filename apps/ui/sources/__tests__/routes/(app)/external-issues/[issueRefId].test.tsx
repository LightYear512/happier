import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';

type TestComponentProps = React.PropsWithChildren<Record<string, unknown>>;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const executionStateGetSpy = vi.fn(async (_issueRefId: string) => ({
    issue: {
        id: 'issue-1',
        issueNumber: 42,
        title: 'Fix sync',
        state: 'open',
        url: 'https://github.com/acme/api/issues/42',
    },
    workflow: {
        workflowState: 'awaiting_review',
        activePrimaryRunId: null,
    },
    activeRun: null,
    latestRuns: [
        {
            id: 'run-1',
            state: 'succeeded',
            generation: 0,
            claimedByMachineId: 'machine-1',
        },
    ],
    providerActions: [
        {
            id: 'action-1',
            actionKind: 'issue_link_back',
            state: 'succeeded',
            providerExternalId: 'github-comment-991',
        },
    ],
    repositoryConnection: {
        id: 'repo-1',
        provider: 'github',
        repositoryKey: 'acme/api',
    },
}));
const stackScreenSpy = vi.fn((_props: unknown) => null);
let localSearchParamsMock: Record<string, unknown> = { issueRefId: 'issue-1' };
let ExternalIssueScreen: typeof import('@/app/(app)/external-issues/[issueRefId]').default;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: 'View',
        Text: 'Text',
        ScrollView: 'ScrollView',
        Pressable: 'Pressable',
        ActivityIndicator: 'ActivityIndicator',
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('expo-router', () => ({
    Stack: { Screen: (props: unknown) => stackScreenSpy(props) },
    useLocalSearchParams: () => localSearchParamsMock,
}));

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

vi.mock('@/sync/ops/externalIssues', () => ({
    externalIssueExecutionStateGet: (issueRefId: string) => executionStateGetSpy(issueRefId),
}));

vi.mock('@/components/ui/layout/ConstrainedScreenContent', () => ({
    ConstrainedScreenContent: (props: TestComponentProps) => React.createElement(
        'ConstrainedScreenContent',
        props,
        props.children,
    ),
}));

describe('External Issue Execution State Screen', () => {
    beforeAll(async () => {
        ({ default: ExternalIssueScreen } = await import('@/app/(app)/external-issues/[issueRefId]'));
    }, 60_000);

    beforeEach(() => {
        localSearchParamsMock = { issueRefId: 'issue-1' };
        stackScreenSpy.mockClear();
        executionStateGetSpy.mockClear();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('loads and renders the coherent external issue execution state', async () => {
        const screen = await renderScreen(React.createElement(ExternalIssueScreen));
        await flushHookEffects({ cycles: 3 });

        expect(executionStateGetSpy).toHaveBeenCalledWith('issue-1');
        const text = screen.getTextContent();
        expect(text).toContain('#42');
        expect(text).toContain('Fix sync');
        expect(text).toContain('awaiting_review');
        expect(text).toContain('run-1');
        expect(text).toContain('succeeded');
        expect(text).toContain('issue_link_back');
        expect(text).toContain('github-comment-991');
    });

    it('does not call the API when the issue route param is missing', async () => {
        localSearchParamsMock = {};

        const screen = await renderScreen(React.createElement(ExternalIssueScreen));
        await flushHookEffects({ cycles: 2 });

        expect(executionStateGetSpy).not.toHaveBeenCalled();
        expect(screen.getTextContent()).toContain('Missing issue reference.');
    });
});
