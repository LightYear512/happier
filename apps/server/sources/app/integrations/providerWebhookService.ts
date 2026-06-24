import { db, type RepositoryProviderKind } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { upsertExternalIssueFromSnapshot } from "@/app/externalIssues/controlPlaneShared";
import { ensureAutomatedSessionRunForIssue } from "@/app/sessionRuns/sessionRunService";

type WebhookResult = Readonly<{
    recorded: boolean;
    deduped: boolean;
}>;

type NormalizedIssueWebhookEvent = Readonly<{
    provider: RepositoryProviderKind;
    providerBaseUrl: string;
    repositoryKey: string;
    receiptKey: string;
    eventKind: string;
    issueNumber: number;
    title: string;
    state: string;
    url: string;
    rawSnapshot: Record<string, unknown>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGithubWebhookEvent(headers: Record<string, unknown>, body: unknown): NormalizedIssueWebhookEvent | null {
    if (!isRecord(body)) {
        return null;
    }
    const repository = isRecord(body.repository) ? body.repository : null;
    const issue = isRecord(body.issue) ? body.issue : null;
    if (!repository || !issue) {
        return null;
    }

    const repositoryUrl = typeof repository.html_url === "string" ? repository.html_url : null;
    const repositoryKey = typeof repository.full_name === "string" ? repository.full_name : null;
    const issueNumber = typeof issue.number === "number" ? issue.number : null;
    const issueTitle = typeof issue.title === "string" ? issue.title : null;
    const issueState = typeof issue.state === "string" ? issue.state : null;
    const issueUrl = typeof issue.html_url === "string" ? issue.html_url : null;
    const receiptKey = typeof headers["x-github-delivery"] === "string" && headers["x-github-delivery"].trim()
        ? `github:${headers["x-github-delivery"]}`
        : null;
    if (!repositoryUrl || !repositoryKey || !issueNumber || !issueTitle || !issueState || !issueUrl || !receiptKey) {
        return null;
    }

    let providerBaseUrl: string;
    try {
        providerBaseUrl = new URL(repositoryUrl).origin;
    } catch {
        return null;
    }

    return {
        provider: "github",
        providerBaseUrl,
        repositoryKey,
        receiptKey,
        eventKind: typeof headers["x-github-event"] === "string" ? headers["x-github-event"] : "github.webhook",
        issueNumber,
        title: issueTitle,
        state: issueState,
        url: issueUrl,
        rawSnapshot: body,
    };
}

function normalizeGitlabWebhookEvent(headers: Record<string, unknown>, body: unknown): NormalizedIssueWebhookEvent | null {
    if (!isRecord(body)) {
        return null;
    }
    const project = isRecord(body.project) ? body.project : null;
    const attributes = isRecord(body.object_attributes) ? body.object_attributes : null;
    if (!project || !attributes) {
        return null;
    }

    const repositoryUrl = typeof project.web_url === "string" ? project.web_url : null;
    const repositoryKey = typeof project.path_with_namespace === "string" ? project.path_with_namespace : null;
    const issueNumber = typeof attributes.iid === "number" ? attributes.iid : null;
    const issueTitle = typeof attributes.title === "string" ? attributes.title : null;
    const issueState = typeof attributes.state === "string" ? attributes.state : null;
    const issueUrl = typeof attributes.url === "string" ? attributes.url : null;
    const webhookToken = typeof headers["x-gitlab-token"] === "string" && headers["x-gitlab-token"].trim()
        ? headers["x-gitlab-token"]
        : null;
    if (!repositoryUrl || !repositoryKey || !issueNumber || !issueTitle || !issueState || !issueUrl || !webhookToken) {
        return null;
    }

    let providerBaseUrl: string;
    try {
        providerBaseUrl = new URL(repositoryUrl).origin;
    } catch {
        return null;
    }

    return {
        provider: "gitlab",
        providerBaseUrl,
        repositoryKey,
        receiptKey: `gitlab:${webhookToken}:${issueNumber}`,
        eventKind: typeof headers["x-gitlab-event"] === "string" ? headers["x-gitlab-event"] : "gitlab.webhook",
        issueNumber,
        title: issueTitle,
        state: issueState,
        url: issueUrl,
        rawSnapshot: body,
    };
}

async function recordWebhookEvent(event: NormalizedIssueWebhookEvent): Promise<WebhookResult> {
    return await inTx(async (tx) => {
        const connection = await tx.repositoryConnection.findFirst({
            where: {
                repositoryKey: event.repositoryKey,
                OR: [
                    { provider: event.provider, providerBaseUrl: event.providerBaseUrl },
                    { providerBaseUrl: event.providerBaseUrl },
                ],
            },
            orderBy: [{ updatedAt: "desc" }],
        });

        if (!connection) {
            return { recorded: true, deduped: false };
        }

        const existing = await tx.providerEventReceipt.findFirst({
            where: {
                repositoryConnectionId: connection.id,
                receiptKey: event.receiptKey,
            },
            select: { id: true },
        });
        if (existing) {
            return { recorded: false, deduped: true };
        }

        const issue = await upsertExternalIssueFromSnapshot({
            tx,
            accountId: connection.accountId,
            repositoryConnectionId: connection.id,
            provider: connection.provider,
            providerBaseUrl: connection.providerBaseUrl,
            repositoryKey: connection.repositoryKey,
            issueNumber: event.issueNumber,
            title: event.title,
            state: event.state,
            url: event.url,
            eventKey: event.receiptKey,
            occurredAt: new Date(),
            rawSnapshot: event.rawSnapshot,
        });

        await ensureAutomatedSessionRunForIssue({
            tx,
            accountId: connection.accountId,
            issueRefId: issue.id,
            triggerKind: "webhook_event",
            idempotencyKey: event.receiptKey,
        });

        await tx.providerEventReceipt.create({
            data: {
                accountId: connection.accountId,
                repositoryConnectionId: connection.id,
                externalIssueRefId: issue.id,
                provider: event.provider,
                receiptKey: event.receiptKey,
                eventKind: event.eventKind,
            },
        });

        return { recorded: true, deduped: false };
    });
}

export async function recordGithubProviderEvent(headers: Record<string, unknown>, body: unknown): Promise<WebhookResult> {
    const event = normalizeGithubWebhookEvent(headers, body);
    if (!event) {
        return { recorded: false, deduped: false };
    }
    return await recordWebhookEvent(event);
}

export async function recordGitlabProviderEvent(headers: Record<string, unknown>, body: unknown): Promise<WebhookResult> {
    const event = normalizeGitlabWebhookEvent(headers, body);
    if (!event) {
        return { recorded: false, deduped: false };
    }
    return await recordWebhookEvent(event);
}
