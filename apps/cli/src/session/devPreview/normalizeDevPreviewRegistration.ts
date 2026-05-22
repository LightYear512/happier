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

const LOOPBACK_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '0:0:0:0:0:0:0:1']);

function normalizeHostname(hostname: string): string {
  const lowered = hostname.trim().toLowerCase();
  if (lowered.startsWith('[') && lowered.endsWith(']')) {
    return lowered.slice(1, -1);
  }
  return lowered;
}

function resolveReachableLoopbackHostname(hostname: string): string {
  const normalized = normalizeHostname(hostname);
  return normalized === '0.0.0.0' ? '127.0.0.1' : normalized;
}

function normalizePreviewUrl(value: unknown): Readonly<{
  url: string;
  origin: string;
  port: number;
  initialPath: string;
}> | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'http:') {
    throw new Error('preview url must use http loopback');
  }
  const normalizedHostname = normalizeHostname(parsed.hostname);
  if (!LOOPBACK_HTTP_HOSTS.has(normalizedHostname)) {
    throw new Error('preview url must use loopback host');
  }
  parsed.hostname = resolveReachableLoopbackHostname(parsed.hostname);
  const port = Number(parsed.port || '80');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('preview url must include a valid port');
  }
  const initialPath = parsed.pathname && parsed.pathname.startsWith('/') ? parsed.pathname : '/';
  return {
    url: parsed.toString(),
    origin: parsed.origin,
    port,
    initialPath,
  };
}

export type SessionDevPreviewRegistrationInput = Readonly<{
  sessionId: string;
  machineId: string;
  port?: number;
  url?: string;
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
  origin?: string;
  url?: string;
  initialPath: string;
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
  const parsedUrl = normalizePreviewUrl(input.url);
  const port = parsedUrl?.port ?? Math.max(1, Math.min(65535, Math.trunc(Number(input.port))));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('preview registration requires a valid port or url');
  }
  const origin = parsedUrl?.origin ?? `http://127.0.0.1:${port}`;
  const url = parsedUrl?.url;
  const initialPath = parsedUrl?.initialPath ?? '/';
  const compositeKey = `${sessionId}\u0000${machineId}\u0000${origin}\u0000${initialPath}`;
  const name = normalizeName(input.name);
  const framework = normalizeFramework(input.framework);

  return {
    compositeKey,
    resourceId: `preview_${hashSuffix(`resource:${compositeKey}`)}`,
    routeKey: `route_${hashSuffix(`route:${compositeKey}`)}`,
    sessionId,
    machineId,
    port,
    origin,
    ...(url ? { url } : {}),
    initialPath,
    ...(name ? { name } : {}),
    ...(framework ? { framework } : {}),
    rewriteUrls: input.rewriteUrls !== false,
    source: input.source ?? 'manual',
    registeredAtMs: Date.now(),
  };
}
