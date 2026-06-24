import { z } from "zod";

import {
    abortSessionRun,
    getSessionRun,
    listSessionRuns,
    retrySessionRun,
} from "@/app/sessionRuns/sessionRunService";
import { SessionRunState } from "@/storage/db";
import { type Fastify } from "../../types";

const runIdParamsSchema = z.object({
    runId: z.string().trim().min(1),
});

/**
 * Account-facing session run inspection and control routes.
 */
export function registerSessionRunRoutes(app: Fastify): void {
    app.get('/v2/session-runs', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                sessionId: z.string().trim().min(1).optional(),
                externalIssueRefId: z.string().trim().min(1).optional(),
                repositoryConnectionId: z.string().trim().min(1).optional(),
                state: z.nativeEnum(SessionRunState).optional(),
                cursor: z.string().trim().min(1).optional(),
                limit: z.coerce.number().int().min(1).max(100).optional(),
            }),
        },
    }, async (request) => {
        const runs = await listSessionRuns(request.userId, request.query);
        return {
            runs,
            nextCursor: null,
        };
    });

    app.get('/v2/session-runs/:runId', {
        preHandler: app.authenticate,
        schema: {
            params: runIdParamsSchema,
        },
    }, async (request, reply) => {
        const result = await getSessionRun(request.userId, request.params.runId);
        if (!result) {
            return reply.code(404).send({ error: "not_found" });
        }
        return result;
    });

    app.post('/v2/session-runs/:runId/retry', {
        preHandler: app.authenticate,
        schema: {
            params: runIdParamsSchema,
            body: z.object({
                machineId: z.string().trim().min(1).optional().nullable(),
                reason: z.string().trim().min(1).optional(),
                idempotencyKey: z.string().trim().min(1),
            }),
        },
    }, async (request, reply) => {
        const run = await retrySessionRun({
            accountId: request.userId,
            runId: request.params.runId,
            ...request.body,
        });
        if (!run) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { run };
    });

    app.post('/v2/session-runs/:runId/abort', {
        preHandler: app.authenticate,
        schema: {
            params: runIdParamsSchema,
        },
    }, async (request, reply) => {
        const body = request.body as { reason?: string } | undefined;
        const result = await abortSessionRun({
            accountId: request.userId,
            runId: request.params.runId,
            reason: body?.reason,
        });
        if (!result) {
            return reply.code(404).send({ error: "not_found" });
        }
        return result;
    });
}
