import { z } from "zod";

import {
    claimSessionRun,
    completeSessionRun,
    expireStaleSessionRuns,
    failSessionRun,
    heartbeatSessionRun,
    startSessionRun,
    waitUserSessionRun,
} from "@/app/sessionRuns/sessionRunService";
import { type Fastify } from "../../types";

const runIdParamsSchema = z.object({
    runId: z.string().trim().min(1),
});

const machineIdSchema = z.string().trim().min(1);
const generationSchema = z.number().int().min(0);
const leaseDurationMsSchema = z.number().int().min(5_000).max(15 * 60_000);

/**
 * Machine-facing session run control surface.
 */
export function registerSessionRunDaemonRoutes(app: Fastify): void {
    app.post('/v2/session-runs/claim', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                machineId: machineIdSchema,
                leaseDurationMs: leaseDurationMsSchema.optional(),
            }),
        },
    }, async (request) => {
        const run = await claimSessionRun({
            accountId: request.userId,
            ...request.body,
        });
        return { run };
    });

    app.post('/v2/session-runs/expire-stale', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                machineId: machineIdSchema,
                limit: z.number().int().min(1).max(100).optional(),
            }),
        },
    }, async (request, reply) => {
        const expired = await expireStaleSessionRuns({
            accountId: request.userId,
            ...request.body,
        });
        if (!expired) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { expired };
    });

    app.post('/v2/session-runs/:runId/heartbeat', {
        preHandler: app.authenticate,
        schema: {
            params: runIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                generation: generationSchema,
                leaseDurationMs: leaseDurationMsSchema.optional(),
                headCommitSha: z.string().trim().min(1).optional(),
            }),
        },
    }, async (request, reply) => {
        const result = await heartbeatSessionRun({
            accountId: request.userId,
            runId: request.params.runId,
            ...request.body,
        });
        if (!result) {
            return reply.code(404).send({ error: "not_found" });
        }
        return {
            ok: result.ok,
            leaseExpiresAt: result.leaseExpiresAt.getTime(),
            serverDirective: result.serverDirective,
        };
    });

    app.post('/v2/session-runs/:runId/start', {
        preHandler: app.authenticate,
        schema: {
            params: runIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                generation: generationSchema,
                headCommitSha: z.string().trim().min(1).optional(),
                branchName: z.string().trim().min(1).optional(),
            }),
        },
    }, async (request, reply) => {
        const run = await startSessionRun({
            accountId: request.userId,
            runId: request.params.runId,
            ...request.body,
        });
        if (!run) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { run };
    });

    app.post('/v2/session-runs/:runId/wait-user', {
        preHandler: app.authenticate,
        schema: {
            params: runIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                generation: generationSchema,
                reasonCode: z.string().trim().min(1),
                reasonMessage: z.string().trim().min(1).optional(),
            }),
        },
    }, async (request, reply) => {
        const result = await waitUserSessionRun({
            accountId: request.userId,
            runId: request.params.runId,
            ...request.body,
        });
        if (!result) {
            return reply.code(404).send({ error: "not_found" });
        }
        return result;
    });

    app.post('/v2/session-runs/:runId/succeed', {
        preHandler: app.authenticate,
        schema: {
            params: runIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                generation: generationSchema,
                branchName: z.string().trim().min(1).optional(),
                providerChangeUrl: z.string().trim().min(1).optional(),
                providerChangeNumber: z.number().int().positive().optional(),
                providerChangeExternalId: z.string().trim().min(1).optional(),
                headCommitSha: z.string().trim().min(1).optional(),
                baseCommitSha: z.string().trim().min(1).optional(),
                summaryCiphertext: z.string().trim().min(1).optional(),
            }),
        },
    }, async (request, reply) => {
        const result = await completeSessionRun({
            accountId: request.userId,
            runId: request.params.runId,
            ...request.body,
        });
        if (!result) {
            return reply.code(404).send({ error: "not_found" });
        }
        return result;
    });

    app.post('/v2/session-runs/:runId/fail', {
        preHandler: app.authenticate,
        schema: {
            params: runIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                generation: generationSchema,
                errorCode: z.string().trim().min(1).optional(),
                errorMessage: z.string().trim().min(1).optional(),
                headCommitSha: z.string().trim().min(1).optional(),
                retryRecommended: z.boolean().optional(),
            }),
        },
    }, async (request, reply) => {
        const result = await failSessionRun({
            accountId: request.userId,
            runId: request.params.runId,
            ...request.body,
        });
        if (!result) {
            return reply.code(404).send({ error: "not_found" });
        }
        return result;
    });
}
