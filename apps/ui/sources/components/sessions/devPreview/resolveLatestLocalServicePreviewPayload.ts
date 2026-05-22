import { LocalServicePreviewV1Schema, type LocalServicePreviewV1 } from '@happier-dev/protocol';

import type { Message } from '@/sync/domains/messages/messageTypes';

export function listLocalServicePreviewPayloads(messages: readonly Message[]): readonly LocalServicePreviewV1[] {
    const previews: LocalServicePreviewV1[] = [];
    const seenResourceIds = new Set<string>();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const happier = message?.meta?.happier;
        if (!happier || typeof happier !== 'object') continue;
        if ((happier as { kind?: unknown }).kind !== 'local_service_preview.v1') continue;
        const parsed = LocalServicePreviewV1Schema.safeParse((happier as { payload?: unknown }).payload);
        if (!parsed.success) continue;
        if (seenResourceIds.has(parsed.data.resourceId)) continue;
        seenResourceIds.add(parsed.data.resourceId);
        previews.push(parsed.data);
    }
    return previews;
}

export function resolveLatestLocalServicePreviewPayload(messages: readonly Message[]): LocalServicePreviewV1 | null {
    return listLocalServicePreviewPayloads(messages)[0] ?? null;
}
