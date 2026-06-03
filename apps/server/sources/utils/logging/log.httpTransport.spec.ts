import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLoggingTransportTargets } from "./log";

const HTTP_ENV_KEYS = [
    "HTTP_LOG_ENABLED",
    "HTTP_LOG_URL",
    "HTTP_LOG_LEVEL",
    "HTTP_LOG_METHOD",
    "HTTP_LOG_HEADERS",
    "HTTP_LOG_TIMEOUT_MS",
    "HTTP_LOG_BATCH_SIZE",
    "HTTP_LOG_FLUSH_INTERVAL_MS",
    "HTTP_LOG_BATCH_FORMAT",
    "HTTP_LOG_STATIC_FIELDS",
    "HTTP_LOG_OMIT_FIELDS",
    "HTTP_LOG_MAX_BUFFER",
];

function findHttpTarget(targets: any[]) {
    return targets.find((t) => typeof t.target === "string" && t.target.includes("httpLogTransport"));
}

describe("utils/logging/log createLoggingTransportTargets (HTTP)", () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const k of HTTP_ENV_KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        for (const k of HTTP_ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
        vi.restoreAllMocks();
    });

    it("does not add an HTTP target by default", () => {
        expect(findHttpTarget(createLoggingTransportTargets())).toBeUndefined();
    });

    it("adds an HTTP target with defaults when enabled with a url", () => {
        process.env.HTTP_LOG_ENABLED = "true";
        process.env.HTTP_LOG_URL = "https://collector.test/ingest";

        const target = findHttpTarget(createLoggingTransportTargets());
        expect(target).toBeDefined();
        expect(target.level).toBe("info");
        expect(target.options.url).toBe("https://collector.test/ingest");
        expect(target.options.method).toBe("POST");
        expect(target.options.timeoutMs).toBe(10000);
        expect(target.options.batchSize).toBe(1);
        expect(target.options.flushIntervalMs).toBe(5000);
        expect(target.options.batchFormat).toBe("array");
        expect(target.options.maxBuffer).toBe(1000);
        expect(target.options).not.toHaveProperty("headers");
        expect(target.options).not.toHaveProperty("staticFields");
        expect(target.options).not.toHaveProperty("omitFields");
    });

    it("skips the HTTP target when enabled but url is missing", () => {
        process.env.HTTP_LOG_ENABLED = "true";
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(findHttpTarget(createLoggingTransportTargets())).toBeUndefined();
        expect(errSpy).toHaveBeenCalledOnce();
    });

    it("parses headers and static fields from JSON", () => {
        process.env.HTTP_LOG_ENABLED = "true";
        process.env.HTTP_LOG_URL = "https://collector.test/ingest";
        process.env.HTTP_LOG_HEADERS = '{"Authorization":"Bearer x"}';
        process.env.HTTP_LOG_STATIC_FIELDS = '{"service":"happier-server"}';

        const target = findHttpTarget(createLoggingTransportTargets());
        expect(target.options.headers).toEqual({ Authorization: "Bearer x" });
        expect(target.options.staticFields).toEqual({ service: "happier-server" });
    });

    it("ignores malformed JSON for headers/static fields without crashing", () => {
        process.env.HTTP_LOG_ENABLED = "true";
        process.env.HTTP_LOG_URL = "https://collector.test/ingest";
        process.env.HTTP_LOG_HEADERS = "{not valid json";
        process.env.HTTP_LOG_STATIC_FIELDS = "[1,2,3]"; // valid JSON but not an object
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const target = findHttpTarget(createLoggingTransportTargets());
        expect(target).toBeDefined();
        expect(target.options).not.toHaveProperty("headers");
        expect(target.options).not.toHaveProperty("staticFields");
        expect(errSpy).toHaveBeenCalledTimes(2);
    });

    it("parses omit fields from a comma-separated list", () => {
        process.env.HTTP_LOG_ENABLED = "true";
        process.env.HTTP_LOG_URL = "https://collector.test/ingest";
        process.env.HTTP_LOG_OMIT_FIELDS = "@timestamp, pid , ";

        const target = findHttpTarget(createLoggingTransportTargets());
        expect(target.options.omitFields).toEqual(["@timestamp", "pid"]);
    });

    it("honors overrides for level, method, batching, format and buffer", () => {
        process.env.HTTP_LOG_ENABLED = "true";
        process.env.HTTP_LOG_URL = "https://collector.test/ingest";
        process.env.HTTP_LOG_LEVEL = "warn";
        process.env.HTTP_LOG_METHOD = "put";
        process.env.HTTP_LOG_TIMEOUT_MS = "3000";
        process.env.HTTP_LOG_BATCH_SIZE = "50";
        process.env.HTTP_LOG_FLUSH_INTERVAL_MS = "2000";
        process.env.HTTP_LOG_BATCH_FORMAT = "ndjson";
        process.env.HTTP_LOG_MAX_BUFFER = "5000";

        const target = findHttpTarget(createLoggingTransportTargets());
        expect(target.level).toBe("warn");
        expect(target.options.method).toBe("put");
        expect(target.options.timeoutMs).toBe(3000);
        expect(target.options.batchSize).toBe(50);
        expect(target.options.flushIntervalMs).toBe(2000);
        expect(target.options.batchFormat).toBe("ndjson");
        expect(target.options.maxBuffer).toBe(5000);
    });
});
