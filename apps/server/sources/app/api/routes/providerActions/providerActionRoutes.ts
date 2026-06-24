import { type Fastify } from "../../types";

import { registerProviderActionDaemonRoutes } from "./registerProviderActionDaemonRoutes";

export function providerActionRoutes(app: Fastify): void {
    registerProviderActionDaemonRoutes(app);
}
