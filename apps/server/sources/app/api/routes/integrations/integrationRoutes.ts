import { type Fastify } from "../../types";

import { registerProviderWebhookRoutes } from "./registerProviderWebhookRoutes";

export function integrationRoutes(app: Fastify): void {
    registerProviderWebhookRoutes(app);
}
