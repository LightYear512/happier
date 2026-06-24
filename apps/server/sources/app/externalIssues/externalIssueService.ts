import { db, IssueWorkflowState, type RepositoryProviderKind } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import {
    getIssueWorkflowOrDefault,
    normalizeIssueState,
    upsertExternalIssueFromSnapshot,
} from "./controlPlaneShared";

type ExternalIssueFilters = Readonly<{
    repositoryConnectionId?: string;
    state?: string;
    limit?: number;
}>;

type ResolveIssueParams = Readonly<{
    accountId: string;
    url?: string;
    provider?: RepositoryProviderKind;
    providerBaseUrl?: string;
    repositoryKey?: string;
    issueNumber?: number;
}>;

type ParsedExternalIssueUrl = Readonly<{
    provider: RepositoryProviderKind;
    providerBaseUrl: string;
    repositoryKey: string;
    issueNumber: number;
}>;

function parseExternalIssueUrl(rawUrl: string): ParsedExternalIssueUrl | null {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 3) {
        return null;
    }

    const issueIndex = segments.lastIndexOf("issues");
    if (issueIndex < 1 || issueIndex === segments.length - 1) {
        return null;
    }

    const rawIssueNumber = Number.parseInt(segments[issueIndex + 1] ?? "", 10);
    if (!Number.isFinite(rawIssueNumber) || rawIssueNumber <= 0) {
        return null;
    }

    const provider: RepositoryProviderKind = segments[issueIndex - 1] === "-" ? "gitlab" : "github";
    const repositorySegments = provider === "gitlab"
        ? segments.slice(0, issueIndex - 1)
        : segments.slice(0, issueIndex);
    if (repositorySegments.length < 2) {
        return null;
    }

    return {
        provider,
        providerBaseUrl: url.origin,
        repositoryKey: repositorySegments.join("/"),
        issueNumber: rawIssueNumber,
    };
}

export async function listExternalIssues(accountId: string, filters: ExternalIssueFilters) {
    const state = filters.state ? normalizeIssueState(filters.state) : undefined;
    const limit = Number.isFinite(filters.limit) ? Math.min(Math.max(Math.floor(filters.limit ?? 50), 1), 100) : 50;
    const issues = await db.externalIssueRef.findMany({
        where: {
            accountId,
            repositoryConnectionId: filters.repositoryConnectionId,
            state,
        },
        include: {
            repositoryConnection: true,
            executionProjection: true,
            sessionRuns: {
                orderBy: [{ generation: "desc" }, { createdAt: "desc" }],
                take: 1,
            },
            providerActions: {
                orderBy: [{ createdAt: "desc" }],
                take: 3,
            },
        },
        orderBy: [{ updatedAt: "desc" }, { issueNumber: "asc" }],
        take: limit,
    });

    const activeRunIds = issues
        .map((issue) => issue.executionProjection?.activePrimaryRunId)
        .filter((runId): runId is string => Boolean(runId));
    const activeRuns = activeRunIds.length > 0
        ? await db.sessionRun.findMany({
            where: {
                accountId,
                id: { in: activeRunIds },
            },
        })
        : [];
    const activeRunsById = new Map(activeRuns.map((run) => [run.id, run]));

    return issues.map((issue) => {
        const {
            executionProjection,
            providerActions,
            repositoryConnection,
            sessionRuns,
            ...externalIssue
        } = issue;
        const workflow = executionProjection ?? {
            id: `workflow:${externalIssue.id}`,
            accountId,
            externalIssueRefId: externalIssue.id,
            workflowState: IssueWorkflowState.idle,
            activePrimarySessionId: null,
            activePrimaryRunId: null,
            currentProviderChangeExternalId: null,
            currentProviderChangeUrl: null,
            subjectHeadSha: null,
            transitionReason: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
        };
        const activeRun = workflow.activePrimaryRunId
            ? activeRunsById.get(workflow.activePrimaryRunId) ?? null
            : null;

        return {
            ...externalIssue,
            workflow,
            activeRun,
            latestRun: sessionRuns[0] ?? null,
            latestProviderActions: providerActions,
            repositoryConnection,
        };
    });
}

export async function resolveExternalIssueRef(params: ResolveIssueParams) {
    const parsed = params.url ? parseExternalIssueUrl(params.url) : null;
    const provider = parsed?.provider ?? params.provider;
    const providerBaseUrl = parsed?.providerBaseUrl ?? params.providerBaseUrl;
    const repositoryKey = parsed?.repositoryKey ?? params.repositoryKey;
    const issueNumber = parsed?.issueNumber ?? params.issueNumber;

    if (!provider || !providerBaseUrl || !repositoryKey || typeof issueNumber !== "number") {
        return null;
    }

    return await inTx(async (tx) => {
        const connection = await tx.repositoryConnection.findFirst({
            where: {
                accountId: params.accountId,
                provider,
                providerBaseUrl,
                repositoryKey,
            },
        });
        if (!connection) {
            return null;
        }

        return await upsertExternalIssueFromSnapshot({
            tx,
            accountId: params.accountId,
            repositoryConnectionId: connection.id,
            provider,
            providerBaseUrl,
            repositoryKey,
            issueNumber,
            state: "open",
            url: parsed?.providerBaseUrl ? params.url : undefined,
        });
    });
}

export async function getExternalIssue(accountId: string, issueRefId: string) {
    const issue = await db.externalIssueRef.findFirst({
        where: {
            id: issueRefId,
            accountId,
        },
    });
    if (!issue) {
        return null;
    }

    const workflow = await getIssueWorkflowOrDefault(accountId, issue.id);
    return { issue, workflow };
}

export async function getExternalIssueExecutionState(accountId: string, issueRefId: string) {
    const issue = await db.externalIssueRef.findFirst({
        where: {
            id: issueRefId,
            accountId,
        },
        include: {
            repositoryConnection: true,
        },
    });
    if (!issue) {
        return null;
    }

    const workflow = await getIssueWorkflowOrDefault(accountId, issue.id);
    const activeRun = workflow.activePrimaryRunId
        ? await db.sessionRun.findFirst({
            where: {
                id: workflow.activePrimaryRunId,
                accountId,
                externalIssueRefId: issue.id,
            },
        })
        : null;
    const latestRuns = await db.sessionRun.findMany({
        where: {
            accountId,
            externalIssueRefId: issue.id,
        },
        orderBy: [{ generation: "desc" }, { createdAt: "desc" }],
        take: 10,
    });
    const providerActions = await db.providerActionRequest.findMany({
        where: {
            accountId,
            externalIssueRefId: issue.id,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 20,
    });

    const { repositoryConnection, ...externalIssue } = issue;

    return {
        issue: externalIssue,
        workflow,
        activeRun,
        latestRuns,
        providerActions,
        repositoryConnection,
    };
}
