import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, pressTestInstance, renderScreen, standardCleanup } from '@/dev/testkit';

type TestComponentProps = React.PropsWithChildren<Record<string, unknown>>;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const externalIssueListSpy = vi.fn(async () => ({
    issues: [
        {
            id: 'issue-1',
            issueNumber: 42,
            title: 'Fix sync',
            state: 'open',
            repositoryKey: 'acme/api',
            workflow: {
                workflowState: 'executing',
                activePrimaryRunId: 'run-1',
            },
            latestRun: {
                id: 'run-1',
                state: 'queued',
                generation: 1,
            },
        },
    ],
    nextCursor: null,
}));
const routerPushSpy = vi.fn();
const stackScreenSpy = vi.fn((_props: unknown) => null);
let ExternalIssueListScreen: typeof import('@/app/(app)/external-issues').default;

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
    useRouter: () => ({
        push: routerPushSpy,
    }),
}));

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

vi.mock('@/sync/ops/externalIssues', () => ({
    externalIssueList: () => externalIssueListSpy(),
}));

vi.mock('@/components/ui/layout/ConstrainedScreenContent', () => ({
    ConstrainedScreenContent: (props: TestComponentProps) => React.createElement(
        'ConstrainedScreenContent',
        props,
        props.children,
    ),
}));

describe('External Issue List Screen', () => {
    beforeAll(async () => {
        ({ default: ExternalIssueListScreen } = await import('@/app/(app)/external-issues'));
    }, 60_000);

    beforeEach(() => {
        externalIssueListSpy.mockClear();
        routerPushSpy.mockClear();
        stackScreenSpy.mockClear();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('lists external issues and navigates to execution state details', async () => {
        const screen = await renderScreen(React.createElement(ExternalIssueListScreen));
        await flushHookEffects({ cycles: 3 });

        expect(externalIssueListSpy).toHaveBeenCalledTimes(1);
        const text = screen.getTextContent();
        expect(text).toContain('#42');
        expect(text).toContain('Fix sync');
        expect(text).toContain('open');
        expect(text).toContain('executing');
        expect(text).toContain('queued');

        const issueRow = screen.findByTestId('external-issue-row:issue-1');
        act(() => {
            pressTestInstance(issueRow, 'external-issue-row:issue-1');
        });

        expect(routerPushSpy).toHaveBeenCalledWith({
            pathname: '/external-issues/[issueRefId]',
            params: { issueRefId: 'issue-1' },
        });
    });

    it('renders an empty state when there are no external issues', async () => {
        externalIssueListSpy.mockResolvedValueOnce({ issues: [], nextCursor: null });

        const screen = await renderScreen(React.createElement(ExternalIssueListScreen));
        await flushHookEffects({ cycles: 3 });

        expect(screen.getTextContent()).toContain('No external issues');
    });
});
