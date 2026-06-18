import { z } from 'zod';

import {
  LocalServicePreviewV1Schema,
  type LocalServicePreviewV1,
} from './localServicePreviewV1.js';

export const LOCAL_SERVICE_PREVIEW_METADATA_MAX_PREVIEWS = 8;

export const LocalServicePreviewsMetadataV1Schema = z.object({
  v: z.literal(1),
  previews: z.array(LocalServicePreviewV1Schema).max(LOCAL_SERVICE_PREVIEW_METADATA_MAX_PREVIEWS),
}).passthrough();
export type LocalServicePreviewsMetadataV1 = z.infer<typeof LocalServicePreviewsMetadataV1Schema>;

export function readLocalServicePreviewsFromSessionMetadata(metadata: unknown): readonly LocalServicePreviewV1[] {
  const root = typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : null;
  const parsed = LocalServicePreviewsMetadataV1Schema.safeParse(root?.localServicePreviewsV1);
  return parsed.success ? parsed.data.previews : [];
}

export function writeLocalServicePreviewToSessionMetadata<TMetadata extends Record<string, unknown>>(
  metadata: TMetadata,
  preview: LocalServicePreviewV1,
): TMetadata & Readonly<{ localServicePreviewsV1: LocalServicePreviewsMetadataV1 }> {
  const existing = readLocalServicePreviewsFromSessionMetadata(metadata);
  const previews = [
    preview,
    ...existing.filter((candidate) => candidate.resourceId !== preview.resourceId),
  ].slice(0, LOCAL_SERVICE_PREVIEW_METADATA_MAX_PREVIEWS);

  return {
    ...metadata,
    localServicePreviewsV1: {
      v: 1,
      previews,
    },
  };
}

export function removeLocalServicePreviewFromSessionMetadata<TMetadata extends Record<string, unknown>>(
  metadata: TMetadata,
  resourceId: string,
): TMetadata & Readonly<{ localServicePreviewsV1: LocalServicePreviewsMetadataV1 }> {
  const normalizedResourceId = resourceId.trim();
  const previews = readLocalServicePreviewsFromSessionMetadata(metadata)
    .filter((candidate) => candidate.resourceId !== normalizedResourceId)
    .slice(0, LOCAL_SERVICE_PREVIEW_METADATA_MAX_PREVIEWS);

  return {
    ...metadata,
    localServicePreviewsV1: {
      v: 1,
      previews,
    },
  };
}
