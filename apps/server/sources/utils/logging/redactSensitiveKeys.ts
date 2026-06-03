const REDACTED_VALUE = "[redacted]";

const SENSITIVE_KEY_PATTERN = /^(authorization|cookie|set-cookie|password|passwd|token|secret|api[_-]?key)$/i;

function redactValueForKey(key: string): string | null {
    return SENSITIVE_KEY_PATTERN.test(key) ? REDACTED_VALUE : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

// Returns a redacted copy only when something actually changes; otherwise the
// original reference is returned unchanged. This keeps the hot logging path
// allocation-free for the common case (a log object with no sensitive keys),
// while preserving identical output semantics.
function redactRecursive(value: unknown, seen: WeakSet<object>): unknown {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value as object)) return value;
    seen.add(value as object);

    if (Array.isArray(value)) {
        let changed = false;
        const out = value.map((v) => {
            const next = redactRecursive(v, seen);
            if (next !== v) changed = true;
            return next;
        });
        return changed ? out : value;
    }

    if (isPlainObject(value)) {
        let out: Record<string, unknown> | undefined;
        for (const [key, v] of Object.entries(value)) {
            const next = redactValueForKey(key) ?? redactRecursive(v, seen);
            if (next !== v) {
                if (!out) out = { ...value };
                out[key] = next;
            }
        }
        return out ?? value;
    }

    return value;
}

/**
 * Recursively redact values whose key matches the sensitive-key pattern
 * (authorization/cookie/password/token/secret/api-key). Shared by the Sentry
 * log integration and the pino logging pipeline so both apply the exact same
 * redaction. Only keys are matched — values embedded in `msg` strings or under
 * differently-named keys are not touched. Returns the input unchanged (same
 * reference) when it is not an object/array or contains no sensitive keys.
 */
export function redactSensitiveKeys<T>(value: T): T {
    if (!value || typeof value !== "object") return value;
    return redactRecursive(value, new WeakSet()) as T;
}
