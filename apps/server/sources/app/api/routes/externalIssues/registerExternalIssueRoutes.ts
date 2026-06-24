import { z } from "zod";

import { RepositoryProviderKind } from "@/storage/db";
import {
    getExternalIssue,
    getExternalIssueExecutionState,
    listExternalIssues,
    resolveExternalIssueRef,
} from "@/app/externalIssues/externalIssueService";
import { launchOrAttachSessionRun } from "@/app/sessionRuns/sessionRunService";
import { type Fastify } from "../../types";

const issueRefIdParamsSchema = z.object({
    issueRefId: z.string().trim().min(1),
});

const resolveExternalIssueBodySchema = z.object({
    url: z.string().trim().min(1).optional(),
    provider: z.enum(RepositoryProviderKind).optional(),
    providerBaseUrl: z.string().trim().min(1).optional(),
    repositoryKey: z.string().trim().min(1).optional(),
    issueNumber: z.number().int().positive().optional(),
}).refine((value) => {
    if (value.url) {
        return true;
    }
    return Boolean(value.provider && value.providerBaseUrl && value.repositoryKey && value.issueNumber);
}, {
    message: 'url or provider/providerBaseUrl/repositoryKey/issueNumber is required',
});

/**
 * Account-facing external issue control-plane routes.
 */
export function registerExternalIssueRoutes(app: Fastify): void {
    app.get('/v2/external-issues', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                repositoryConnectionId: z.string().trim().min(1).optional(),
                state: z.string().trim().min(1).optional(),
                label: z.string().trim().min(1).optional(),
                linkedSessionId: z.string().trim().min(1).optional(),
                activeRunState: z.string().trim().min(1).optional(),
                cursor: z.string().trim().min(1).optional(),
                limit: z.coerce.number().int().min(1).max(100).optional(),
            }),
        },
    }, async (request) => {
        const issues = await listExternalIssues(request.userId, request.query);
        return {
            issues,
            nextCursor: null,
        };
    });

    app.post('/v2/external-issues/resolve', {
        preHandler: app.authenticate,
        schema: {
            body: resolveExternalIssueBodySchema,
        },
    }, async (request, reply) => {
        const issue = await resolveExternalIssueRef({
            accountId: request.userId,
            ...request.body,
        });
        if (!issue) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { issue };
    });

    app.get('/v2/external-issues/:issueRefId/execution-state', {
        preHandler: app.authenticate,
        schema: {
            params: issueRefIdParamsSchema,
        },
    }, async (request, reply) => {
        const result = await getExternalIssueExecutionState(request.userId, request.params.issueRefId);
        if (!result) {
            return reply.code(404).send({ error: "not_found" });
        }
        return result;
    });

    app.get('/v2/external-issues/:issueRefId', {
        preHandler: app.authenticate,
        schema: {
            params: issueRefIdParamsSchema,
        },
    }, async (request, reply) => {
        const result = await getExternalIssue(request.userId, request.params.issueRefId);
        if (!result) {
            return reply.code(404).send({ error: "not_found" });
        }
        return result;
    });

    app.post('/v2/external-issues/:issueRefId/launch', {
        preHandler: app.authenticate,
        schema: {
            params: issueRefIdParamsSchema,
            body: z.object({
                sessionId: z.string().trim().min(1).optional().nullable(),
                machineId: z.string().trim().min(1).optional().nullable(),
                forceNewSession: z.boolean().optional(),
                comment: z.string().trim().min(1).optional(),
                idempotencyKey: z.string().trim().min(1),
            }),
        },
    }, async (request, reply) => {
        const result = await launchOrAttachSessionRun({
            accountId: request.userId,
            issueRefId: request.params.issueRefId,
            ...request.body,
        });
        if (!result) {
            return reply.code(404).send({ error: "not_found" });
        }
        return result;
    });
}
