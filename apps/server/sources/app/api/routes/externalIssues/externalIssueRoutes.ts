import { type Fastify } from "../../types";

import { registerExternalIssueRoutes } from "./registerExternalIssueRoutes";

export function externalIssueRoutes(app: Fastify): void {
    registerExternalIssueRoutes(app);
}
