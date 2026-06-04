const COMPACT_FAILURE_NEEDLE = 'error running remote compact task';

type RecordLike = Record<string, unknown>;

export type CodexAppServerCompactRescueGate = Readonly<{
    tryClaim: (nowMs: number) => boolean;
    release: () => void;
}>;

function readRecord(value: unknown): RecordLike | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as RecordLike
        : null;
}

function readTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function extractCodexAppServerCompactErrorDetail(value: unknown): string {
    const record = readRecord(value);
    if (!record) return '';

    const directError = readRecord(record.error);
    const turn = readRecord(record.turn);
    const turnError = readRecord(turn?.error);
    const error = directError ?? turnError;
    if (!error) {
        return readTrimmedString(record.error) ?? readTrimmedString(record.message) ?? '';
    }

    return [
        readTrimmedString(error.message),
        readTrimmedString(error.additionalDetails ?? error.additional_details),
    ].filter((part): part is string => Boolean(part)).join('\n\n');
}

export function shouldAutoRescueCodexAppServerCompactFailure(params: unknown): boolean {
    const record = readRecord(params);
    if (!record || record.willRetry === true) return false;

    return extractCodexAppServerCompactErrorDetail(params)
        .toLowerCase()
        .includes(COMPACT_FAILURE_NEEDLE);
}

export function createCodexAppServerCompactRescueGate(cooldownMs: number): CodexAppServerCompactRescueGate {
    let lastClaimedAtMs: number | null = null;
    return {
        tryClaim(nowMs: number): boolean {
            if (lastClaimedAtMs !== null && nowMs - lastClaimedAtMs < cooldownMs) {
                return false;
            }
            lastClaimedAtMs = nowMs;
            return true;
        },
        release(): void {
            lastClaimedAtMs = null;
        },
    };
}
