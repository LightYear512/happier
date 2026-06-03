import build from 'pino-abstract-transport';

// Generic, env-driven pino transport that ships log records to an arbitrary
// HTTP endpoint. It is intentionally NOT specific to any single collector: the
// per-deployment shape (single vs batched, body format, extra/omitted fields,
// auth headers) is fully configured through options resolved from env in
// `log.ts`. A custom collector (e.g. a POST-only ingestion gateway) is just one
// configuration of this transport, not a special case in the code.
//
// Redaction: sensitive keys are already redacted upstream by `formatLogObject`
// (pino `formatters.log`, shared with the stdout/file/Elasticsearch targets and
// the Sentry integration), so by the time records reach this worker they are
// already scrubbed. This transport does not re-redact.
//
// Runs in a pino worker thread, so a slow/unavailable endpoint never blocks the
// main event loop. All network failures are swallowed (never thrown back into
// the stream) and surfaced via rate-limited stderr, and the in-memory buffer is
// bounded to avoid unbounded growth when the endpoint is down.

export interface HttpLogTransportOptions {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    batchSize?: number;
    flushIntervalMs?: number;
    batchFormat?: 'array' | 'ndjson';
    staticFields?: Record<string, unknown>;
    omitFields?: readonly string[];
    maxBuffer?: number;
}

type LogRecord = Record<string, unknown>;

const ERROR_LOG_INTERVAL_MS = 60_000;

/**
 * Apply per-log transforms before shipping:
 *  - `staticFields` are laid down first so real log fields win on key collision
 *    (a static `service` never clobbers `msg`/`level`).
 *  - `omitFields` deletes top-level keys only (predictable; matches the common
 *    "drop this envelope field" need without surprising nested behavior).
 * Returns the original reference when there is nothing to do.
 */
export function applyLogTransforms(
    obj: LogRecord,
    staticFields: Record<string, unknown> | undefined,
    omitFields: readonly string[] | undefined,
): LogRecord {
    const hasStatic = !!staticFields && Object.keys(staticFields).length > 0;
    const hasOmit = !!omitFields && omitFields.length > 0;
    if (!hasStatic && !hasOmit) return obj;

    const out: LogRecord = hasStatic ? { ...staticFields, ...obj } : { ...obj };
    if (hasOmit) {
        for (const key of omitFields!) {
            delete out[key];
        }
    }
    return out;
}

/**
 * Serialize a batch into an HTTP body. The wire shape is decided by batchSize:
 *  - batchSize <= 1: a single JSON object (the caller guarantees one record).
 *  - batchSize > 1 : `array` => JSON array; `ndjson` => newline-delimited JSON.
 */
export function serializeBatch(
    logs: ReadonlyArray<LogRecord>,
    batchSize: number,
    batchFormat: 'array' | 'ndjson',
): { body: string; contentType: string } {
    if (batchSize <= 1) {
        return { body: JSON.stringify(logs[0] ?? {}), contentType: 'application/json' };
    }
    if (batchFormat === 'ndjson') {
        return { body: logs.map((l) => JSON.stringify(l)).join('\n'), contentType: 'application/x-ndjson' };
    }
    return { body: JSON.stringify(logs), contentType: 'application/json' };
}

/**
 * Resolve the effective flush interval. A non-positive interval is allowed when
 * batchSize <= 1 (every push flushes immediately, so no timer is needed), but
 * with batching enabled it would strand partial batches forever — so we force a
 * sane floor to guarantee logs always drain.
 */
export function resolveFlushInterval(flushIntervalMs: number | undefined, batchSize: number): number {
    if (typeof flushIntervalMs === 'number' && flushIntervalMs > 0) return flushIntervalMs;
    return batchSize > 1 ? 5_000 : 0;
}

export interface BatcherDeps {
    batchSize: number;
    flushIntervalMs: number;
    maxBuffer: number;
    post: (batch: LogRecord[]) => Promise<void>;
    onDrop?: (totalDropped: number) => void;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
}

/**
 * Bounded, serialized batcher.
 *  - `push` enqueues; when the buffer reaches `maxBuffer` the OLDEST record is
 *    dropped (and counted) so memory stays bounded if the endpoint is down.
 *  - flushes are serialized: only one `post` is in flight at a time; concurrent
 *    triggers (size threshold + interval) collapse into the running drain loop.
 *  - `post` is expected to swallow its own errors; the loop has a backstop catch
 *    so a thrown post can never wedge the batcher.
 */
export function createBatcher(deps: BatcherDeps) {
    const effectiveBatch = deps.batchSize > 1 ? deps.batchSize : 1;
    const buffer: LogRecord[] = [];
    let dropped = 0;
    let flushPromise: Promise<void> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    // Returns the in-flight drain when one is already running, so concurrent
    // triggers (size threshold, interval, close) collapse onto the same promise
    // and `close()` can await actual completion rather than no-op early.
    function flush(): Promise<void> {
        if (flushPromise) return flushPromise;
        flushPromise = (async () => {
            try {
                while (buffer.length > 0) {
                    const batch = buffer.splice(0, effectiveBatch);
                    try {
                        await deps.post(batch);
                    } catch {
                        // post() owns its error reporting; this is only a wedge guard.
                    }
                }
            } finally {
                flushPromise = null;
            }
        })();
        return flushPromise;
    }

    function push(item: LogRecord): void {
        if (buffer.length >= deps.maxBuffer) {
            buffer.shift();
            dropped++;
            deps.onDrop?.(dropped);
        }
        buffer.push(item);
        if (buffer.length >= effectiveBatch) {
            void flush();
        }
    }

    function start(): void {
        if (timer || deps.flushIntervalMs <= 0) return;
        const si = deps.setIntervalFn ?? setInterval;
        timer = si(() => {
            void flush();
        }, deps.flushIntervalMs);
        if (timer && typeof (timer as any).unref === 'function') (timer as any).unref();
    }

    async function close(): Promise<void> {
        if (timer) {
            (deps.clearIntervalFn ?? clearInterval)(timer);
            timer = null;
        }
        await flush();
    }

    return {
        push,
        flush,
        start,
        close,
        stats: () => ({ buffered: buffer.length, dropped }),
    };
}

export default async function httpLogTransport(opts: HttpLogTransportOptions) {
    const url = opts.url;
    const method = (opts.method ?? 'POST').toUpperCase();
    const headers = opts.headers ?? {};
    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 10_000;
    const batchSize = opts.batchSize && opts.batchSize > 0 ? opts.batchSize : 1;
    const flushIntervalMs = resolveFlushInterval(opts.flushIntervalMs, batchSize);
    const batchFormat: 'array' | 'ndjson' = opts.batchFormat === 'ndjson' ? 'ndjson' : 'array';
    const maxBuffer = opts.maxBuffer && opts.maxBuffer > 0 ? opts.maxBuffer : 1_000;

    let lastErrorLogAt = 0;
    function reportError(message: string): void {
        const now = Date.now();
        if (now - lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
            lastErrorLogAt = now;
            console.error('[PINO][http-log] ' + message);
        }
    }

    async function post(batch: LogRecord[]): Promise<void> {
        const { body, contentType } = serializeBatch(batch, batchSize, batchFormat);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                method,
                headers: { 'content-type': contentType, ...headers },
                body,
                signal: controller.signal,
            });
            // Always drain the body so the connection can be reused / freed.
            try {
                await res.arrayBuffer();
            } catch {
                // ignore
            }
            if (!res.ok) {
                reportError(`POST ${url} -> HTTP ${res.status}; dropped ${batch.length} log(s)`);
            }
        } catch (err) {
            const name = (err as { name?: string })?.name ?? 'error';
            reportError(`POST ${url} failed (${name}); dropped ${batch.length} log(s)`);
        } finally {
            clearTimeout(timeout);
        }
    }

    const batcher = createBatcher({
        batchSize,
        flushIntervalMs,
        maxBuffer,
        post,
        onDrop: (total) => reportError(`buffer exceeded ${maxBuffer}; dropping oldest (total dropped ${total})`),
    });
    batcher.start();

    return build(
        async (source) => {
            for await (const obj of source) {
                batcher.push(applyLogTransforms(obj as LogRecord, opts.staticFields, opts.omitFields));
            }
        },
        {
            async close() {
                await batcher.close();
            },
        },
    );
}
