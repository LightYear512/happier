import pino from 'pino';
import { mkdirSync } from 'fs';
import { join } from 'path';

import { parseIntEnv, parseOptionalBooleanEnv } from '@/config/env';
import { redactSensitiveKeys } from '@/utils/logging/redactSensitiveKeys';

// Single log file name created once at startup
let consolidatedLogFile: string | undefined;

if (process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING) {
    const logsDir = join(process.cwd(), '.logs');
    try {
        mkdirSync(logsDir, { recursive: true });
        // Create filename once at startup
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const sec = String(now.getSeconds()).padStart(2, '0');
        consolidatedLogFile = join(logsDir, `${month}-${day}-${hour}-${min}-${sec}.log`);
        console.log(`[PINO] Remote debugging logs enabled - writing to ${consolidatedLogFile}`);
    } catch (error) {
        console.error('Failed to create logs directory:', error);
    }
}

// Format time as HH:MM:ss.mmm in local time
function formatLocalTime(timestamp?: number) {
    const date = timestamp ? new Date(timestamp) : new Date();
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');
    const secs = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hours}:${mins}:${secs}.${ms}`;
}

function isBunRuntime() {
    const g = globalThis as any;
    return Boolean(g?.Bun) || Boolean((process as any)?.versions?.bun);
}

export function resolveServerLogLevelFromEnv(env: NodeJS.ProcessEnv): pino.LevelWithSilent {
    const raw = (
        env.HAPPIER_SERVER_LOG_LEVEL
        ?? env.HAPPIER_LOG_LEVEL
        ?? env.LOG_LEVEL
        ?? ""
    ).trim().toLowerCase();
    const allowed = new Set<pino.LevelWithSilent>(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
    return allowed.has(raw as pino.LevelWithSilent) ? (raw as pino.LevelWithSilent) : "info";
}

export function createLoggingTransportTargets(): any[] {
    const transports: any[] = [];

    // Bun-compiled binaries can't reliably resolve pino transport targets.
    if (!isBunRuntime()) {
        transports.push({
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss.l',
                ignore: 'pid,hostname',
                messageFormat: '{levelLabel} {msg} | [{time}]',
                errorLikeObjectKeys: ['err', 'error'],
            },
        });
    }

    if (process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING && consolidatedLogFile) {
        transports.push({
            target: 'pino/file',
            options: {
                destination: consolidatedLogFile,
                mkdir: true,
                messageFormat: '{levelLabel} {msg} | [server time: {time}]',
            },
        });
    }

    // Ship logs to an existing Elasticsearch when configured. The transport runs
    // in a pino worker thread, so a slow/unavailable ES affects only that worker
    // and never blocks the main event loop. Skipped under Bun-compiled binaries,
    // where pino transport targets don't resolve reliably (same as pino-pretty).
    if (!isBunRuntime() && parseOptionalBooleanEnv(process.env.ES_LOG_ENABLED)) {
        const node = (process.env.ES_LOG_NODE ?? '').trim();
        if (!node) {
            console.error('[PINO] ES_LOG_ENABLED is set but ES_LOG_NODE is missing - skipping Elasticsearch transport');
        } else {
            // Only attach `auth` when credentials are actually configured.
            // Passing an empty {username,password} would send a bogus empty
            // basic-auth header and override credentials embedded in ES_LOG_NODE
            // (e.g. https://user:pass@host) or a cert-based / unauthenticated setup.
            const apiKey = (process.env.ES_LOG_API_KEY ?? '').trim();
            const username = (process.env.ES_LOG_USERNAME ?? '').trim();
            const auth = apiKey
                ? { apiKey }
                : username
                    ? { username, password: process.env.ES_LOG_PASSWORD ?? '' }
                    : undefined;
            transports.push({
                target: 'pino-elasticsearch',
                // ES is opt-in for higher-signal logs; ship info+ by default to bound
                // volume (the base logger stays at debug for stdout/file).
                level: (process.env.ES_LOG_LEVEL ?? 'info').trim(),
                options: {
                    node,
                    index: (process.env.ES_LOG_INDEX ?? 'happier-logs').trim(),
                    esVersion: parseIntEnv(process.env.ES_LOG_ES_VERSION, 8),
                    flushBytes: parseIntEnv(process.env.ES_LOG_FLUSH_BYTES, 1000),
                    flushInterval: parseIntEnv(process.env.ES_LOG_FLUSH_INTERVAL, 5000),
                    ...(auth ? { auth } : {}),
                    tls: { rejectUnauthorized: parseOptionalBooleanEnv(process.env.ES_LOG_REJECT_UNAUTHORIZED) ?? true },
                },
            });
        }
    }

    return transports;
}

// Shared pino `formatters.log` hook: redact sensitive fields (same pattern as
// Sentry) before any transport (stdout / file / Elasticsearch) sees the log
// object, then stamp localTime on every entry. Exported for testing.
export function formatLogObject(object: any) {
    return {
        ...redactSensitiveKeys(object),
        localTime: formatLocalTime(typeof object.time === 'number' ? object.time : undefined),
    };
}

// Main server logger with local time formatting
const transportTargets = createLoggingTransportTargets();
export const logger = pino({
    level: resolveServerLogLevelFromEnv(process.env),
    ...(transportTargets.length
        ? {
            transport: {
                targets: transportTargets,
            },
        }
        : {}),
    formatters: {
        log: formatLogObject,
    },
    timestamp: () => `,"time":${Date.now()},"localTime":"${formatLocalTime()}"`,
});

// Optional file-only logger for remote logs from CLI/mobile
export const fileConsolidatedLogger = process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING && consolidatedLogFile ? 
    pino({
        level: resolveServerLogLevelFromEnv(process.env),
        transport: {
            targets: [{
                target: 'pino/file',
                options: {
                    destination: consolidatedLogFile,
                    mkdir: true,
                },
            }],
        },
        formatters: {
            // Same redaction + localTime stamping as the main logger.
            // Note: source property already exists from CLI/mobile logs
            log: formatLogObject,
        },
        timestamp: () => `,"time":${Date.now()},"localTime":"${formatLocalTime()}"`,
    }) : undefined;

export function log(src: any, ...args: any[]) {
    logger.info(src, ...args);
}

export function warn(src: any, ...args: any[]) {
    logger.warn(src, ...args);
}

export function error(src: any, ...args: any[]) {
    logger.error(src, ...args);
}

export function debug(src: any, ...args: any[]) {
    logger.debug(src, ...args);
}
