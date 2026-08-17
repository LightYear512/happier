import { FastifyBaseLogger, FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { IncomingMessage, Server, ServerResponse } from "http";
import type { SessionDevPreviewSocketRelayBridge } from "@/app/devPreview/sessionDevPreviewSocketRelayBridge";

export type Fastify = FastifyInstance<
    Server<typeof IncomingMessage, typeof ServerResponse>,
    IncomingMessage,
    ServerResponse<IncomingMessage>,
    FastifyBaseLogger,
    ZodTypeProvider
>;

declare module 'fastify' {
    interface FastifyRequest {
        userId: string;
        startTime?: number;
    }
    interface FastifyInstance {
        authenticate: any;
        sessionDevPreviewSocketRelay?: SessionDevPreviewSocketRelayBridge;
    }
}
