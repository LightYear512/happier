import { createHash } from 'node:crypto';

import type {
  LocalServicePreviewFramework,
  LocalServicePreviewSource,
} from '@happier-dev/protocol';

function hashSuffix(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 24);
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeFramework(value: unknown): LocalServicePreviewFramework | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  switch (normalized) {
    case 'vite':
    case 'next':
    case 'webpack':
    case 'cra':
    case 'expo-web':
    case 'astro':
    case 'sveltekit':
    case 'other':
      return normalized;
    default:
      return 'other';
  }
}

export type SessionDevPreviewRegistrationInput = Readonly<{
  sessionId: string;
  machineId: string;
  port: number;
  name?: string;
  framework?: string;
  healthPath?: string;
  rewriteUrls?: boolean;
  source?: LocalServicePreviewSource;
}>;

export type NormalizedSessionDevPreviewRegistration = Readonly<{
  compositeKey: string;
  resourceId: string;
  routeKey: string;
  sessionId: string;
  machineId: string;
  port: number;
  name?: string;
  framework?: LocalServicePreviewFramework;
  rewriteUrls: boolean;
  source: LocalServicePreviewSource;
  registeredAtMs: number;
}>;

export function normalizeDevPreviewRegistration(
  input: SessionDevPreviewRegistrationInput,
): NormalizedSessionDevPreviewRegistration {
  const sessionId = String(input.sessionId).trim();
  const machineId = String(input.machineId).trim();
  const port = Math.max(1, Math.min(65535, Math.trunc(input.port)));
  const compositeKey = `${sessionId}\u0000${machineId}\u0000${port}`;
  const name = normalizeName(input.name);
  const framework = normalizeFramework(input.framework);

  return {
    compositeKey,
    resourceId: `preview_${hashSuffix(`resource:${compositeKey}`)}`,
    routeKey: `route_${hashSuffix(`route:${compositeKey}`)}`,
    sessionId,
    machineId,
    port,
    ...(name ? { name } : {}),
    ...(framework ? { framework } : {}),
    rewriteUrls: input.rewriteUrls !== false,
    source: input.source ?? 'manual',
    registeredAtMs: Date.now(),
  };
}
