import { apiSocket } from '../api/session/apiSocket';

export type ExternalIssueExecutionStateResult =
    | ExternalIssueExecutionState
    | { ok: false; error: string; status?: number };

export type ExternalIssueListResult =
    | ExternalIssueListResponse
    | { ok: false; error: string; status?: number };

export type ExternalIssueListResponse = Readonly<{
    issues: readonly ExternalIssueSummary[];
    nextCursor: string | null;
}>;

export type ExternalIssueListFilters = Readonly<{
    repositoryConnectionId?: string | null;
    state?: string | null;
    limit?: number | null;
}>;

export type ExternalIssueExecutionState = Readonly<{
    issue: ExternalIssueSummary;
    workflow: ExternalIssueWorkflowSummary;
    activeRun: ExternalIssueSessionRunSummary | null;
    latestRuns: readonly ExternalIssueSessionRunSummary[];
    providerActions: readonly ExternalIssueProviderActionSummary[];
    repositoryConnection: ExternalIssueRepositoryConnectionSummary | null;
}>;

export type ExternalIssueSummary = Readonly<{
    id: string;
    issueNumber?: number | null;
    title?: string | null;
    state?: string | null;
    url?: string | null;
    repositoryKey?: string | null;
    workflow?: ExternalIssueWorkflowSummary | null;
    activeRun?: ExternalIssueSessionRunSummary | null;
    latestRun?: ExternalIssueSessionRunSummary | null;
    latestProviderActions?: readonly ExternalIssueProviderActionSummary[];
    repositoryConnection?: ExternalIssueRepositoryConnectionSummary | null;
}>;

export type ExternalIssueWorkflowSummary = Readonly<{
    workflowState?: string | null;
    activePrimaryRunId?: string | null;
}>;

export type ExternalIssueSessionRunSummary = Readonly<{
    id: string;
    state?: string | null;
    generation?: number | null;
    claimedByMachineId?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
}>;

export type ExternalIssueProviderActionSummary = Readonly<{
    id: string;
    actionKind?: string | null;
    state?: string | null;
    sessionRunId?: string | null;
    providerExternalId?: string | null;
    lastErrorCode?: string | null;
}>;

export type ExternalIssueRepositoryConnectionSummary = Readonly<{
    id?: string | null;
    provider?: string | null;
    repositoryKey?: string | null;
}>;

function readObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readErrorMessage(value: unknown, fallback: string): string {
    const object = readObject(value);
    const error = object?.error;
    return typeof error === 'string' && error.trim().length > 0 ? error : fallback;
}

async function readJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text.trim()) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
}

function isExternalIssueExecutionState(value: unknown): value is ExternalIssueExecutionState {
    const object = readObject(value);
    return Boolean(
        object
        && readObject(object.issue)
        && readObject(object.workflow)
        && Array.isArray(object.latestRuns)
        && Array.isArray(object.providerActions),
    );
}

function isExternalIssueListResponse(value: unknown): value is ExternalIssueListResponse {
    const object = readObject(value);
    return Boolean(object && Array.isArray(object.issues));
}

function appendQueryParam(query: URLSearchParams, key: string, value: string | number | null | undefined): void {
    if (value == null) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    query.set(key, normalized);
}

function buildExternalIssueListPath(filters: ExternalIssueListFilters = {}): string {
    const query = new URLSearchParams();
    appendQueryParam(query, 'repositoryConnectionId', filters.repositoryConnectionId);
    appendQueryParam(query, 'state', filters.state);
    appendQueryParam(query, 'limit', filters.limit);
    const encoded = query.toString();
    return encoded ? `/v2/external-issues?${encoded}` : '/v2/external-issues';
}

export async function externalIssueList(filters: ExternalIssueListFilters = {}): Promise<ExternalIssueListResult> {
    try {
        const response = await apiSocket.request(buildExternalIssueListPath(filters));
        const body = await readJsonResponse(response);
        if (!response.ok) {
            return {
                ok: false,
                error: readErrorMessage(body, `Request failed with status ${response.status}`),
                status: response.status,
            };
        }
        if (!isExternalIssueListResponse(body)) {
            return { ok: false, error: 'unsupported_external_issue_list' };
        }
        return {
            issues: body.issues,
            nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function externalIssueExecutionStateGet(issueRefId: string): Promise<ExternalIssueExecutionStateResult> {
    const normalizedIssueRefId = String(issueRefId ?? '').trim();
    if (!normalizedIssueRefId) {
        return { ok: false, error: 'missing_issue_ref_id' };
    }

    try {
        const response = await apiSocket.request(
            `/v2/external-issues/${encodeURIComponent(normalizedIssueRefId)}/execution-state`,
        );
        const body = await readJsonResponse(response);
        if (!response.ok) {
            return {
                ok: false,
                error: readErrorMessage(body, `Request failed with status ${response.status}`),
                status: response.status,
            };
        }
        if (!isExternalIssueExecutionState(body)) {
            return { ok: false, error: 'unsupported_external_issue_execution_state' };
        }
        return body;
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
