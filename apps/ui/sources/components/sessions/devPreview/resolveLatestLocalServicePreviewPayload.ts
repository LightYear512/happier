import {
    LocalServicePreviewV1Schema,
    readLocalServicePreviewsFromSessionMetadata,
    type LocalServicePreviewV1,
} from '@happier-dev/protocol';

import type { Message } from '@/sync/domains/messages/messageTypes';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLocalServicePreviewPayload(value: unknown): LocalServicePreviewV1 | null {
    const parsed = LocalServicePreviewV1Schema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value) as unknown;
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function readTextFromToolResultContentItem(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (!isRecord(value)) return null;
    const text = value.text;
    return typeof text === 'string' ? text : null;
}

function readPreviewPayloadFromToolResult(result: unknown): LocalServicePreviewV1 | null {
    const direct = typeof result === 'string'
        ? parseJsonRecord(result)
        : isRecord(result)
            ? result
            : null;
    const parsedDirect = parseLocalServicePreviewPayload(direct);
    if (parsedDirect) return parsedDirect;

    const content = direct?.content;
    if (!Array.isArray(content)) return null;

    for (const item of content) {
        const text = readTextFromToolResultContentItem(item);
        if (!text) continue;
        const parsed = parseLocalServicePreviewPayload(parseJsonRecord(text));
        if (parsed) return parsed;
    }

    return null;
}

function readPreviewPayloadFromMessageMeta(message: Message): LocalServicePreviewV1 | null {
    const happier = message.meta?.happier;
    if (!isRecord(happier)) return null;
    if (happier.kind !== 'local_service_preview.v1') return null;
    return parseLocalServicePreviewPayload(happier.payload);
}

function readPreviewPayloadFromMessage(message: Message): LocalServicePreviewV1 | null {
    const fromMeta = readPreviewPayloadFromMessageMeta(message);
    if (fromMeta) return fromMeta;

    if (message.kind !== 'tool-call') return null;
    const toolName = message.tool.name;
    if (toolName !== 'mcp__happier__happier_dev_preview_register' && toolName !== 'happier_dev_preview_register') {
        return null;
    }
    return readPreviewPayloadFromToolResult(message.tool.result);
}

export function listLocalServicePreviewPayloads(messages: readonly Message[]): readonly LocalServicePreviewV1[] {
    const previews: LocalServicePreviewV1[] = [];
    const seenResourceIds = new Set<string>();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const preview = readPreviewPayloadFromMessage(message);
        if (!preview) continue;
        if (seenResourceIds.has(preview.resourceId)) continue;
        seenResourceIds.add(preview.resourceId);
        previews.push(preview);
    }
    return previews;
}

export function listLocalServicePreviewPayloadsFromSources(params: Readonly<{
    metadata: unknown;
    messages: readonly Message[];
}>): readonly LocalServicePreviewV1[] {
    const previews: LocalServicePreviewV1[] = [];
    const seenResourceIds = new Set<string>();
    for (const preview of readLocalServicePreviewsFromSessionMetadata(params.metadata)) {
        if (seenResourceIds.has(preview.resourceId)) continue;
        seenResourceIds.add(preview.resourceId);
        previews.push(preview);
    }
    for (const preview of listLocalServicePreviewPayloads(params.messages)) {
        if (seenResourceIds.has(preview.resourceId)) continue;
        seenResourceIds.add(preview.resourceId);
        previews.push(preview);
    }
    return previews;
}

export function resolveLatestLocalServicePreviewPayload(messages: readonly Message[]): LocalServicePreviewV1 | null {
    return listLocalServicePreviewPayloads(messages)[0] ?? null;
}
