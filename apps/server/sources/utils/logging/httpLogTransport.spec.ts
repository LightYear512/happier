import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";

import httpLogTransport, {
    applyLogTransforms,
    serializeBatch,
    createBatcher,
    resolveFlushInterval,
} from "./httpLogTransport";

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("utils/logging/httpLogTransport applyLogTransforms", () => {
    it("returns the same reference when there is nothing to do", () => {
        const obj = { a: 1, msg: "x" };
        expect(applyLogTransforms(obj, undefined, undefined)).toBe(obj);
        expect(applyLogTransforms(obj, {}, [])).toBe(obj);
    });

    it("merges static fields with real log fields winning on collision", () => {
        const out = applyLogTransforms({ msg: "real", n: 1 }, { service: "happier", msg: "static" }, undefined);
        expect(out.service).toBe("happier");
        expect(out.msg).toBe("real");
        expect(out.n).toBe(1);
    });

    it("omits only top-level keys and does not mutate the input", () => {
        const input = { keep: 1, drop: 2, nested: { drop: 3 } };
        const out = applyLogTransforms(input, undefined, ["drop"]);
        expect(out).toEqual({ keep: 1, nested: { drop: 3 } });
        expect(input.drop).toBe(2); // original untouched
    });

    it("applies static fields and omits together", () => {
        const out = applyLogTransforms({ msg: "x", secretEnvelope: "y" }, { service: "happier" }, ["secretEnvelope"]);
        expect(out).toEqual({ service: "happier", msg: "x" });
    });
});

describe("utils/logging/httpLogTransport serializeBatch", () => {
    it("sends a single JSON object when batchSize <= 1", () => {
        const { body, contentType } = serializeBatch([{ a: 1 }], 1, "array");
        expect(body).toBe('{"a":1}');
        expect(contentType).toBe("application/json");
    });

    it("sends a JSON array when batched with array format", () => {
        const { body, contentType } = serializeBatch([{ a: 1 }, { b: 2 }], 10, "array");
        expect(body).toBe('[{"a":1},{"b":2}]');
        expect(contentType).toBe("application/json");
    });

    it("sends newline-delimited JSON when batched with ndjson format", () => {
        const { body, contentType } = serializeBatch([{ a: 1 }, { b: 2 }], 10, "ndjson");
        expect(body).toBe('{"a":1}\n{"b":2}');
        expect(contentType).toBe("application/x-ndjson");
    });
});

describe("utils/logging/httpLogTransport resolveFlushInterval", () => {
    it("keeps a positive interval as-is", () => {
        expect(resolveFlushInterval(2000, 1)).toBe(2000);
        expect(resolveFlushInterval(2000, 10)).toBe(2000);
    });

    it("allows no timer when not batching (batchSize <= 1)", () => {
        expect(resolveFlushInterval(0, 1)).toBe(0);
        expect(resolveFlushInterval(undefined, 1)).toBe(0);
        expect(resolveFlushInterval(-5, 1)).toBe(0);
    });

    it("forces a positive floor when batching to avoid stranded partial batches", () => {
        expect(resolveFlushInterval(0, 10)).toBe(5000);
        expect(resolveFlushInterval(undefined, 10)).toBe(5000);
        expect(resolveFlushInterval(-1, 10)).toBe(5000);
    });
});

describe("utils/logging/httpLogTransport createBatcher", () => {
    it("flushes when the buffer reaches batchSize", async () => {
        const batches: number[] = [];
        const batcher = createBatcher({
            batchSize: 2,
            flushIntervalMs: 0,
            maxBuffer: 100,
            post: async (b) => {
                batches.push(b.length);
            },
        });

        batcher.push({ n: 1 });
        await tick();
        expect(batches).toEqual([]); // 1 < 2, no flush yet

        batcher.push({ n: 2 });
        await tick();
        expect(batches).toEqual([2]);
        expect(batcher.stats().buffered).toBe(0);
    });

    it("drops the oldest record and counts when maxBuffer is exceeded", () => {
        const batcher = createBatcher({
            batchSize: 100, // high so push never auto-flushes
            flushIntervalMs: 0,
            maxBuffer: 2,
            post: async () => {},
        });

        batcher.push({ n: 1 });
        batcher.push({ n: 2 });
        batcher.push({ n: 3 }); // evicts {n:1}

        expect(batcher.stats()).toEqual({ buffered: 2, dropped: 1 });
    });

    it("serializes flushes (never two posts in flight)", async () => {
        let inFlight = 0;
        let maxConcurrent = 0;
        const batcher = createBatcher({
            batchSize: 1,
            flushIntervalMs: 0,
            maxBuffer: 100,
            post: async () => {
                inFlight++;
                maxConcurrent = Math.max(maxConcurrent, inFlight);
                await tick();
                inFlight--;
            },
        });

        batcher.push({ n: 1 });
        batcher.push({ n: 2 });
        batcher.push({ n: 3 });
        // batchSize 1 => one post per record; drain the serialized chain.
        for (let i = 0; i < 20 && batcher.stats().buffered > 0; i++) await tick();

        expect(maxConcurrent).toBe(1);
        expect(batcher.stats().buffered).toBe(0);
    });

    it("waits for an in-flight flush to finish on close (no early resolve)", async () => {
        const order: string[] = [];
        let resolvePost: (() => void) | null = null;
        const batcher = createBatcher({
            batchSize: 1,
            flushIntervalMs: 0,
            maxBuffer: 100,
            post: async () => {
                order.push("post-start");
                await new Promise<void>((r) => {
                    resolvePost = r;
                });
                order.push("post-end");
            },
        });

        batcher.push({ n: 1 }); // starts an in-flight post that is now blocked
        await tick();
        const closed = batcher.close().then(() => order.push("closed"));
        await tick();
        expect(order).toEqual(["post-start"]); // close must not have resolved yet
        resolvePost!();
        await closed;
        expect(order).toEqual(["post-start", "post-end", "closed"]);
    });

    it("flushes remaining records and clears the timer on close", async () => {
        const cleared: unknown[] = [];
        const posted: number[] = [];
        const batcher = createBatcher({
            batchSize: 100,
            flushIntervalMs: 1000,
            maxBuffer: 100,
            post: async (b) => {
                posted.push(b.length);
            },
            setIntervalFn: (() => 123 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
            clearIntervalFn: ((id: unknown) => {
                cleared.push(id);
            }) as unknown as typeof clearInterval,
        });

        batcher.start();
        batcher.push({ n: 1 });
        batcher.push({ n: 2 });
        await batcher.close();

        expect(posted).toEqual([2]);
        expect(cleared).toEqual([123]);
    });
});

describe("utils/logging/httpLogTransport default export (in-process)", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("posts transformed logs via fetch", async () => {
        const calls: Array<{ url: string; init: any }> = [];
        const fakeFetch = vi.fn(async (url: any, init: any) => {
            calls.push({ url: String(url), init });
            return new Response("ok", { status: 200 });
        });
        vi.stubGlobal("fetch", fakeFetch);

        const stream: any = await httpLogTransport({
            url: "http://collector.test/ingest",
            batchSize: 1,
            flushIntervalMs: 0,
            staticFields: { service: "happier" },
            omitFields: ["envelope"],
        });

        stream.write(JSON.stringify({ level: 30, msg: "hi", envelope: "drop-me" }) + "\n");
        stream.end();
        await once(stream, "close");

        expect(fakeFetch).toHaveBeenCalledTimes(1);
        expect(calls[0].url).toBe("http://collector.test/ingest");
        expect(calls[0].init.method).toBe("POST");
        const body = JSON.parse(calls[0].init.body);
        expect(body.service).toBe("happier");
        expect(body.msg).toBe("hi");
        expect(body).not.toHaveProperty("envelope");
    });

    it("does not throw when the endpoint fails", async () => {
        const fakeFetch = vi.fn(async () => {
            throw new Error("ECONNREFUSED");
        });
        vi.stubGlobal("fetch", fakeFetch);
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const stream: any = await httpLogTransport({
            url: "http://down.test/ingest",
            batchSize: 1,
            flushIntervalMs: 0,
        });

        stream.write(JSON.stringify({ level: 50, msg: "boom" }) + "\n");
        stream.end();
        await once(stream, "close");

        expect(fakeFetch).toHaveBeenCalledTimes(1);
        expect(errSpy).toHaveBeenCalled(); // failure surfaced, not thrown
    });
});
