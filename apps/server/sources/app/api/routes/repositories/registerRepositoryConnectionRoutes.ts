import { z } from "zod";

import {
    RepositoryAuthKind,
    RepositoryConnectionMode,
    RepositoryProviderKind,
} from "@/storage/db";
import {
    bindRepositoryLocalCheckout,
    claimRepositoryPollLease,
    getRepositoryConnection,
    getVerificationPolicy,
    heartbeatRepositoryPollLease,
    listRepositoryConnections,
    pushPolledEvents,
    refreshRepositoryConnectionCapabilities,
    upsertRepositoryConnection,
    upsertVerificationPolicy,
} from "@/app/repositories/repositoryConnectionService";
import { type Fastify } from "../../types";

const connectionIdParamsSchema = z.object({
    connectionId: z.string().trim().min(1),
});

const machineIdSchema = z.string().trim().min(1);
const leaseDurationMsSchema = z.number().int().min(5_000).max(15 * 60_000);

const capabilitySnapshotSchema = z.object({
    webhookEnabled: z.boolean().optional(),
    remoteCiDetected: z.boolean().optional(),
    defaultBranch: z.string().trim().min(1).optional(),
    localCheckoutPath: z.string().trim().min(1).optional(),
    mergePolicy: z.string().trim().min(1).optional(),
}).partial();

const normalizedProviderEventSchema = z.object({
    eventKey: z.string().trim().min(1),
    occurredAt: z.number().int(),
    kind: z.string().trim().min(1),
    issueNumber: z.number().int().positive().optional(),
    providerChangeExternalId: z.string().trim().min(1).optional(),
    headCommitSha: z.string().trim().min(1).optional(),
    command: z.string().trim().min(1).optional(),
    snapshot: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Repository connection and provider event control routes.
 */
export function registerRepositoryConnectionRoutes(app: Fastify): void {
    app.get('/v2/repositories/connections', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                provider: z.enum(RepositoryProviderKind).optional(),
                mode: z.enum(RepositoryConnectionMode).optional(),
                enabled: z.coerce.boolean().optional(),
                repositoryKey: z.string().trim().min(1).optional(),
            }),
        },
    }, async (request) => {
        const connections = await listRepositoryConnections(request.userId, request.query);
        return { connections };
    });

    app.post('/v2/repositories/connections', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                provider: z.enum(RepositoryProviderKind),
                providerBaseUrl: z.string().trim().min(1),
                repositoryKey: z.string().trim().min(1),
                mode: z.enum(RepositoryConnectionMode),
                authKind: z.enum(RepositoryAuthKind),
                pollerEnabled: z.boolean().optional(),
                pollingOwnerMachineId: machineIdSchema.optional().nullable(),
            }),
        },
    }, async (request) => {
        const connection = await upsertRepositoryConnection({
            accountId: request.userId,
            ...request.body,
        });
        return { connection };
    });

    app.get('/v2/repositories/connections/:connectionId', {
        preHandler: app.authenticate,
        schema: {
            params: connectionIdParamsSchema,
        },
    }, async (request, reply) => {
        const connection = await getRepositoryConnection(request.userId, request.params.connectionId);
        if (!connection) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { connection };
    });

    app.post('/v2/repositories/connections/:connectionId/refresh', {
        preHandler: app.authenticate,
        schema: {
            params: connectionIdParamsSchema,
        },
    }, async (request, reply) => {
        const connection = await refreshRepositoryConnectionCapabilities(request.userId, request.params.connectionId);
        if (!connection) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { connection };
    });

    app.post('/v2/repositories/connections/:connectionId/local-checkout', {
        preHandler: app.authenticate,
        schema: {
            params: connectionIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                localCheckoutPath: z.string().trim().min(1),
            }),
        },
    }, async (request, reply) => {
        const connection = await bindRepositoryLocalCheckout({
            accountId: request.userId,
            connectionId: request.params.connectionId,
            machineId: request.body.machineId,
            localCheckoutPath: request.body.localCheckoutPath,
        });
        if (!connection) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { ok: true, connection };
    });

    app.get('/v2/repositories/connections/:connectionId/verification-policy', {
        preHandler: app.authenticate,
        schema: {
            params: connectionIdParamsSchema,
        },
    }, async (request, reply) => {
        const policy = await getVerificationPolicy(request.userId, request.params.connectionId);
        if (!policy) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { policy };
    });

    app.post('/v2/repositories/connections/:connectionId/verification-policy', {
        preHandler: app.authenticate,
        schema: {
            params: connectionIdParamsSchema,
            body: z.object({
                requiresRemoteCi: z.boolean(),
                allowsLocalVerifyFallback: z.boolean(),
                autoMergeEligible: z.boolean(),
                blockingSuites: z.array(z.string().trim().min(1)).optional(),
                localVerifyCommands: z.array(z.string().trim().min(1)).optional(),
            }),
        },
    }, async (request, reply) => {
        const policy = await upsertVerificationPolicy({
            accountId: request.userId,
            connectionId: request.params.connectionId,
            ...request.body,
        });
        if (!policy) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { policy };
    });

    app.post('/v2/repositories/connections/:connectionId/poller/claim', {
        preHandler: app.authenticate,
        schema: {
            params: connectionIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                leaseDurationMs: leaseDurationMsSchema.optional(),
            }),
        },
    }, async (request, reply) => {
        const connection = await claimRepositoryPollLease({
            accountId: request.userId,
            connectionId: request.params.connectionId,
            ...request.body,
        });
        if (!connection.ok) {
            if (connection.error === "poll_lease_conflict") {
                return reply.code(409).send({ error: connection.error });
            }
            return reply.code(404).send({ error: "not_found" });
        }
        return { ok: true, connection: connection.connection };
    });

    app.post('/v2/repositories/connections/:connectionId/poller/heartbeat', {
        preHandler: app.authenticate,
        schema: {
            params: connectionIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                leaseDurationMs: leaseDurationMsSchema.optional(),
                capabilities: capabilitySnapshotSchema.optional(),
            }),
        },
    }, async (request, reply) => {
        const connection = await heartbeatRepositoryPollLease({
            accountId: request.userId,
            connectionId: request.params.connectionId,
            ...request.body,
        });
        if (!connection) {
            return reply.code(404).send({ error: "not_found" });
        }
        return { ok: true, connection };
    });

    app.post('/v2/repositories/connections/:connectionId/events/push', {
        preHandler: app.authenticate,
        schema: {
            params: connectionIdParamsSchema,
            body: z.object({
                machineId: machineIdSchema,
                events: z.array(normalizedProviderEventSchema).min(1),
            }),
        },
    }, async (request, reply) => {
        const result = await pushPolledEvents({
            accountId: request.userId,
            connectionId: request.params.connectionId,
            ...request.body,
        });
        if (!result.ok) {
            if (result.error === "poll_lease_required") {
                return reply.code(409).send({ error: result.error });
            }
            return reply.code(404).send({ error: "not_found" });
        }
        return {
            recorded: result.recorded,
            deduped: result.deduped,
            issues: result.issues,
        };
    });
}
