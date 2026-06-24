import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('../api/session/apiSocket', () => ({
    apiSocket: {
        request: requestMock,
    },
}));

describe('external issue ops', () => {
    let externalIssues: typeof import('./externalIssues');

    beforeAll(async () => {
        vi.resetModules();
        externalIssues = await import('./externalIssues');
    }, 60_000);

    beforeEach(() => {
        requestMock.mockReset();
    });

    it('loads an external issue execution state from the server REST API', async () => {
        requestMock.mockResolvedValueOnce(new Response(JSON.stringify({
            issue: { id: 'issue-1', issueNumber: 42, title: 'Fix sync', state: 'open' },
            workflow: { workflowState: 'awaiting_review', activePrimaryRunId: null },
            activeRun: null,
            latestRuns: [{ id: 'run-1', state: 'succeeded', generation: 0 }],
            providerActions: [{ id: 'action-1', actionKind: 'issue_link_back', state: 'succeeded' }],
            repositoryConnection: { id: 'repo-1', provider: 'github', repositoryKey: 'acme/api' },
        })));

        const result = await externalIssues.externalIssueExecutionStateGet('issue-1');

        expect(requestMock).toHaveBeenCalledWith('/v2/external-issues/issue-1/execution-state');
        expect(result).toEqual(expect.objectContaining({
            issue: expect.objectContaining({ id: 'issue-1', issueNumber: 42 }),
            workflow: expect.objectContaining({ workflowState: 'awaiting_review' }),
            latestRuns: [expect.objectContaining({ id: 'run-1', state: 'succeeded' })],
            providerActions: [expect.objectContaining({ id: 'action-1', state: 'succeeded' })],
        }));
    });

    it('lists external issues from the server REST API', async () => {
        requestMock.mockResolvedValueOnce(new Response(JSON.stringify({
            issues: [
                { id: 'issue-1', issueNumber: 42, title: 'Fix sync', state: 'open' },
                { id: 'issue-2', issueNumber: 43, title: 'Retry poller', state: 'closed' },
            ],
            nextCursor: null,
        })));

        const result = await externalIssues.externalIssueList();

        expect(requestMock).toHaveBeenCalledWith('/v2/external-issues');
        expect(result).toEqual({
            issues: [
                expect.objectContaining({ id: 'issue-1', issueNumber: 42, state: 'open' }),
                expect.objectContaining({ id: 'issue-2', issueNumber: 43, state: 'closed' }),
            ],
            nextCursor: null,
        });
    });

    it('passes list filters through query parameters', async () => {
        requestMock.mockResolvedValueOnce(new Response(JSON.stringify({ issues: [], nextCursor: null })));

        await externalIssues.externalIssueList({
            repositoryConnectionId: 'repo-1',
            state: 'open',
            limit: 25,
        });

        expect(requestMock).toHaveBeenCalledWith('/v2/external-issues?repositoryConnectionId=repo-1&state=open&limit=25');
    });

    it('returns ok:false when the server returns a non-2xx response', async () => {
        requestMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'missing issue' }), { status: 404 }));

        const result = await externalIssues.externalIssueExecutionStateGet('issue-missing');

        expect(result).toEqual({
            ok: false,
            error: 'missing issue',
            status: 404,
        });
    });

    it('fails closed when the issue id is empty', async () => {
        const result = await externalIssues.externalIssueExecutionStateGet('  ');

        expect(requestMock).not.toHaveBeenCalled();
        expect(result).toEqual({
            ok: false,
            error: 'missing_issue_ref_id',
        });
    });
});
