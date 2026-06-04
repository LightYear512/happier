import { readFile } from 'node:fs/promises';

import { collectCodexSessionRolloutFiles } from '../../directSessions/collectCodexSessionRolloutFiles';
import { resolveConfiguredCodexHome } from '../../utils/resolveConfiguredCodexHome';

export const CODEX_APP_SERVER_COMPACT_SEED_SENTINEL = '<!--HAPPY-COMPACT-SEED-v1-->';

const DEFAULT_MAX_SEED_CHARS = 48_000;
const RECENT_MESSAGE_LIMIT = 12;

type RecordLike = Record<string, unknown>;
type SeedMessage = Readonly<{
    role: 'user' | 'assistant';
    text: string;
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

function readConfiguredMaxSeedChars(env: NodeJS.ProcessEnv): number {
    const raw = Number.parseInt(String(env.HAPPIER_CODEX_APP_SERVER_COMPACT_RESCUE_SEED_MAX_CHARS ?? ''), 10);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_SEED_CHARS;
    return Math.max(2_000, Math.min(200_000, Math.trunc(raw)));
}

function extractContentText(content: unknown): string | null {
    if (typeof content === 'string') return readTrimmedString(content);
    if (!Array.isArray(content)) return null;

    const parts: string[] = [];
    for (const item of content) {
        const record = readRecord(item);
        if (!record) continue;
        const text = readTrimmedString(record.text)
            ?? readTrimmedString(record.input_text)
            ?? readTrimmedString(record.output_text);
        if (text) parts.push(text);
    }
    return readTrimmedString(parts.join(''));
}

function extractMessageFromRecord(record: RecordLike): SeedMessage | null {
    const candidate = readRecord(record.message) ?? readRecord(record.item) ?? readRecord(record.payload) ?? record;
    const role = readTrimmedString(candidate.role);
    if (role !== 'user' && role !== 'assistant') return null;

    const text = extractContentText(candidate.content)
        ?? readTrimmedString(candidate.text)
        ?? readTrimmedString(candidate.message);
    if (!text) return null;

    return { role, text };
}

function extractCompactedText(record: RecordLike): string | null {
    const payload = readRecord(record.payload) ?? record;
    const type = readTrimmedString(record.type) ?? readTrimmedString(payload.type);
    if (type !== 'compacted' && type !== 'context_compacted') return null;

    const directMessage = readTrimmedString(payload.message);
    if (directMessage) return directMessage;

    const replacementHistory = payload.replacement_history;
    if (!Array.isArray(replacementHistory)) return null;

    const parts: string[] = [];
    for (const item of replacementHistory) {
        const replacement = readRecord(item);
        if (!replacement) continue;
        const text = extractContentText(replacement.content) ?? readTrimmedString(replacement.text);
        if (text) parts.push(text);
    }
    return readTrimmedString(parts.join('\n'));
}

function parseRolloutMessages(contents: string): SeedMessage[] {
    const messages: SeedMessage[] = [];
    let compactedText: string | null = null;

    for (const line of contents.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        const record = readRecord(parsed);
        if (!record) continue;

        const compacted = extractCompactedText(record);
        if (compacted) {
            compactedText = compacted;
            messages.length = 0;
            continue;
        }

        const message = extractMessageFromRecord(record);
        if (!message) continue;
        if (message.role === 'user' && message.text.startsWith(CODEX_APP_SERVER_COMPACT_SEED_SENTINEL)) {
            compactedText = message.text;
            messages.length = 0;
            continue;
        }
        messages.push(message);
    }

    return [
        ...(compactedText ? [{ role: 'assistant' as const, text: compactedText }] : []),
        ...messages.slice(-RECENT_MESSAGE_LIMIT),
    ];
}

function trimToMaxChars(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    const marker = '\n\n[Earlier local compact seed content omitted to fit the configured budget.]\n\n';
    const sentinelPrefix = `${CODEX_APP_SERVER_COMPACT_SEED_SENTINEL}\n`;
    if (value.startsWith(sentinelPrefix)) {
        const keepChars = Math.max(0, maxChars - sentinelPrefix.length - marker.length);
        return `${sentinelPrefix}${marker}${value.slice(value.length - keepChars)}`;
    }
    const keepChars = Math.max(0, maxChars - marker.length);
    return `${marker}${value.slice(value.length - keepChars)}`;
}

function renderSeed(messages: readonly SeedMessage[], maxChars: number): string {
    const body = messages.length > 0
        ? messages.map((message) => {
            const label = message.role === 'user' ? 'User' : 'Assistant';
            return `### ${label}\n${message.text}`;
        }).join('\n\n')
        : 'No local Codex rollout messages were found for the failed compact thread.';

    return trimToMaxChars([
        CODEX_APP_SERVER_COMPACT_SEED_SENTINEL,
        '## Local Compact Fallback Seed',
        'The previous Codex remote compact task failed. Continue with this locally reconstructed context.',
        '',
        body,
    ].join('\n'), maxChars);
}

export async function buildCodexAppServerCompactSeed(params: Readonly<{
    env: NodeJS.ProcessEnv;
    threadId: string;
}>): Promise<string> {
    const maxChars = readConfiguredMaxSeedChars(params.env);
    const codexHome = resolveConfiguredCodexHome(params.env);
    const rolloutFiles = await collectCodexSessionRolloutFiles({
        codexHome,
        remoteSessionId: params.threadId,
    });
    const latestRollout = rolloutFiles.at(-1);
    if (!latestRollout) {
        return renderSeed([], maxChars);
    }

    const contents = await readFile(latestRollout.filePath, 'utf8');
    return renderSeed(parseRolloutMessages(contents), maxChars);
}

export function applyCodexAppServerCompactSeedToPrompt(params: Readonly<{
    seed: string;
    prompt: string;
}>): string {
    return `${params.seed}\n\n---\n\n${params.prompt}`;
}
