import { z } from "zod";

import {
    claimProviderAction,
    completeProviderAction,
    failProviderAction,
    heartbeatProviderAction,
    startProviderAction,
} from "@/app/providerActions/providerActionService";
import { type Fastify } from "../../types";

const actionIdParamsSchema = z.object({
    actionId: z.string().trim().min(1),
});

const machineIdSchema = z.string().trim().min(1);
const leaseDurationMsSchema = z.number().int().min(5_000).max(15 * 60_000);

/**
 * Machine-facing provider action control surface.
 */
export function registerProviderActionDaemonRoutes(app: Fastify): void {
    app.post('/v2/provider-actions/claim', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                machineId: machineIdSchema,
                leaseDurationMs: leaseDurationMsSchema.optional(),
            }),
        },
    }, async (request) => {
        const action = await claimProviderAction({
            accountId: request.userId,
            ...request.body,
        });
        return { action };
    });

    app.post('/v2/provider-actions/:actionId/heartbeat', {
        preHandler: app.authenticate,
        schema: {
            params: actionIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                leaseDurationMs: leaseDurationMsSchema.optional(),
            }),
        },
    }, async (request, reply) => {
        const result = await heartbeatProviderAction({
            accountId: request.userId,
            actionId: request.params.actionId,
            ...request.body,
        });
        if (!result) {
            return reply.code(404).send({ error: "not_found" });
        }
        return {
            ok: result.ok,
            leaseExpiresAt: result.leaseExpiresAt.getTime(),
        };
    });

    app.post('/v2/provider-actions/:actionId/start', {
        preHandler: app.authenticate,
        schema: {
            params: actionIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
            }),
        },
    }, async (request, reply) => {
        const action = await startProviderAction({
            accountId: request.userId,
            actionId: request.params.actionId,
            ...request.body,
        });
        if (!action) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { action };
    });

    app.post('/v2/provider-actions/:actionId/succeed', {
        preHandler: app.authenticate,
        schema: {
            params: actionIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                providerExternalId: z.string().trim().min(1).optional(),
                summary: z.string().trim().min(1).optional(),
            }),
        },
    }, async (request, reply) => {
        const action = await completeProviderAction({
            accountId: request.userId,
            actionId: request.params.actionId,
            ...request.body,
        });
        if (!action) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { action };
    });

    app.post('/v2/provider-actions/:actionId/fail', {
        preHandler: app.authenticate,
        schema: {
            params: actionIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                errorCode: z.string().trim().min(1).optional(),
                errorMessage: z.string().trim().min(1).optional(),
                retryRecommended: z.boolean().optional(),
            }),
        },
    }, async (request, reply) => {
        const action = await failProviderAction({
            accountId: request.userId,
            actionId: request.params.actionId,
            ...request.body,
        });
        if (!action) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { action };
    });
}
