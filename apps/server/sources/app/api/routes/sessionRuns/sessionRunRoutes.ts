import { type Fastify } from "../../types";

import { registerSessionRunDaemonRoutes } from "./registerSessionRunDaemonRoutes";
import { registerSessionRunRoutes } from "./registerSessionRunRoutes";

export function sessionRunRoutes(app: Fastify): void {
    registerSessionRunRoutes(app);
    registerSessionRunDaemonRoutes(app);
}
