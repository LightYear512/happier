import { ZodTypeProvider } from "fastify-type-provider-zod";

import { type Fastify } from "../../types";
import { integrationRoutes } from "../integrations/integrationRoutes";
import { providerActionRoutes } from "../providerActions/providerActionRoutes";
import { repositoryRoutes } from "../repositories/repositoryRoutes";
import { sessionRunRoutes } from "../sessionRuns/sessionRunRoutes";
import { externalIssueRoutes } from "./externalIssueRoutes";

function registerLenientEmptyJsonBodyParser(app: Fastify): void {
    const defaultJsonParser = app.getDefaultJsonParser("error", "error");
    app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
        const rawBody = typeof body === "string" ? body : body.toString("utf8");
        if (rawBody.length === 0) {
            done(null, undefined);
            return;
        }
        defaultJsonParser(request, rawBody, done);
    });
}

export function externalIssueControlPlaneRoutes(app: Fastify): void {
    app.register(async (controlPlaneApp) => {
        const typed = controlPlaneApp.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
        registerLenientEmptyJsonBodyParser(typed);
        repositoryRoutes(typed);
        externalIssueRoutes(typed);
        sessionRunRoutes(typed);
        providerActionRoutes(typed);
        integrationRoutes(typed);
    });
}
