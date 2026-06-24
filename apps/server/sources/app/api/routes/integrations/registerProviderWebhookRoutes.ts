import { z } from "zod";

import {
    recordGithubProviderEvent,
    recordGitlabProviderEvent,
} from "@/app/integrations/providerWebhookService";
import { type Fastify } from "../../types";

const githubWebhookHeadersSchema = z.object({
    'x-github-event': z.string().trim().min(1),
    'x-github-delivery': z.string().trim().min(1).optional(),
    'x-hub-signature-256': z.string().trim().min(1).optional(),
}).passthrough();

const gitlabWebhookHeadersSchema = z.object({
    'x-gitlab-event': z.string().trim().min(1),
    'x-gitlab-token': z.string().trim().min(1).optional(),
}).passthrough();

/**
 * Provider webhook ingress routes.
 */
export function registerProviderWebhookRoutes(app: Fastify): void {
    app.post('/v1/integrations/github/webhook', {
        schema: {
            headers: githubWebhookHeadersSchema,
            body: z.unknown(),
        },
    }, async (request, reply) => {
        const result = await recordGithubProviderEvent(request.headers as Record<string, unknown>, request.body);
        return reply.code(202).send(result);
    });

    app.post('/v1/integrations/gitlab/webhook', {
        schema: {
            headers: gitlabWebhookHeadersSchema,
            body: z.unknown(),
        },
    }, async (request, reply) => {
        const result = await recordGitlabProviderEvent(request.headers as Record<string, unknown>, request.body);
        return reply.code(202).send(result);
    });
}
