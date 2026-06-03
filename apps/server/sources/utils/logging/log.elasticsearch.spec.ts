import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLoggingTransportTargets, formatLogObject } from "./log";

const ES_ENV_KEYS = [
    "ES_LOG_ENABLED",
    "ES_LOG_NODE",
    "ES_LOG_INDEX",
    "ES_LOG_LEVEL",
    "ES_LOG_API_KEY",
    "ES_LOG_USERNAME",
    "ES_LOG_PASSWORD",
    "ES_LOG_ES_VERSION",
    "ES_LOG_FLUSH_BYTES",
    "ES_LOG_FLUSH_INTERVAL",
    "ES_LOG_REJECT_UNAUTHORIZED",
];

function findEsTarget(targets: any[]) {
    return targets.find((t) => t.target === "pino-elasticsearch");
}

describe("utils/logging/log createLoggingTransportTargets (Elasticsearch)", () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const k of ES_ENV_KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        for (const k of ES_ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
        vi.restoreAllMocks();
    });

    it("does not add an Elasticsearch target by default", () => {
        expect(findEsTarget(createLoggingTransportTargets())).toBeUndefined();
    });

    it("adds an Elasticsearch target with defaults when enabled with a node", () => {
        process.env.ES_LOG_ENABLED = "true";
        process.env.ES_LOG_NODE = "https://es.internal:9200";

        const target = findEsTarget(createLoggingTransportTargets());
        expect(target).toBeDefined();
        expect(target.level).toBe("info");
        expect(target.options.node).toBe("https://es.internal:9200");
        expect(target.options.index).toBe("happier-logs");
        expect(target.options.esVersion).toBe(8);
        expect(target.options.flushBytes).toBe(1000);
        expect(target.options.flushInterval).toBe(5000);
        expect(target.options.tls).toEqual({ rejectUnauthorized: true });
    });

    it("skips the Elasticsearch target when enabled but node is missing", () => {
        process.env.ES_LOG_ENABLED = "true";
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(findEsTarget(createLoggingTransportTargets())).toBeUndefined();
        expect(errSpy).toHaveBeenCalledOnce();
    });

    it("prefers API key auth over basic auth", () => {
        process.env.ES_LOG_ENABLED = "true";
        process.env.ES_LOG_NODE = "https://es.internal:9200";
        process.env.ES_LOG_API_KEY = "secret-key";
        process.env.ES_LOG_USERNAME = "u";
        process.env.ES_LOG_PASSWORD = "p";

        const target = findEsTarget(createLoggingTransportTargets());
        expect(target.options.auth).toEqual({ apiKey: "secret-key" });
    });

    it("falls back to basic auth when no API key is provided", () => {
        process.env.ES_LOG_ENABLED = "true";
        process.env.ES_LOG_NODE = "https://es.internal:9200";
        process.env.ES_LOG_USERNAME = "u";
        process.env.ES_LOG_PASSWORD = "p";

        const target = findEsTarget(createLoggingTransportTargets());
        expect(target.options.auth).toEqual({ username: "u", password: "p" });
    });

    it("omits auth entirely when no credentials are configured", () => {
        process.env.ES_LOG_ENABLED = "true";
        process.env.ES_LOG_NODE = "https://es.internal:9200";
        // No API key, no username/password: must not send an empty basic-auth
        // object (which would override URL-embedded or cert-based credentials).

        const target = findEsTarget(createLoggingTransportTargets());
        expect(target.options).not.toHaveProperty("auth");
    });

    it("omits auth when only a password is set (no username)", () => {
        process.env.ES_LOG_ENABLED = "true";
        process.env.ES_LOG_NODE = "https://es.internal:9200";
        process.env.ES_LOG_PASSWORD = "p";

        const target = findEsTarget(createLoggingTransportTargets());
        expect(target.options).not.toHaveProperty("auth");
    });

    it("honors overrides for index, level, version, batching and tls", () => {
        process.env.ES_LOG_ENABLED = "true";
        process.env.ES_LOG_NODE = "https://es.internal:9200";
        process.env.ES_LOG_INDEX = "custom-index";
        process.env.ES_LOG_LEVEL = "warn";
        process.env.ES_LOG_ES_VERSION = "7";
        process.env.ES_LOG_FLUSH_BYTES = "2048";
        process.env.ES_LOG_FLUSH_INTERVAL = "1000";
        process.env.ES_LOG_REJECT_UNAUTHORIZED = "false";

        const target = findEsTarget(createLoggingTransportTargets());
        expect(target.level).toBe("warn");
        expect(target.options.index).toBe("custom-index");
        expect(target.options.esVersion).toBe(7);
        expect(target.options.flushBytes).toBe(2048);
        expect(target.options.flushInterval).toBe(1000);
        expect(target.options.tls).toEqual({ rejectUnauthorized: false });
    });
});

describe("utils/logging/log formatLogObject", () => {
    it("redacts sensitive fields and stamps localTime", () => {
        const out: any = formatLogObject({
            msg: "hi",
            token: "secret",
            headers: { authorization: "Bearer x", accept: "json" },
            time: 0,
        });
        expect(out.token).toBe("[redacted]");
        expect(out.headers.authorization).toBe("[redacted]");
        expect(out.headers.accept).toBe("json");
        expect(typeof out.localTime).toBe("string");
    });

    it("preserves non-sensitive fields unchanged", () => {
        const out: any = formatLogObject({ level: 30, count: 5 });
        expect(out.level).toBe(30);
        expect(out.count).toBe(5);
    });
});
