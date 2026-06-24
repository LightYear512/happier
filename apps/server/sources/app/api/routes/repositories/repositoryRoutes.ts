import { type Fastify } from "../../types";

import { registerRepositoryConnectionRoutes } from "./registerRepositoryConnectionRoutes";

export function repositoryRoutes(app: Fastify): void {
    registerRepositoryConnectionRoutes(app);
}
