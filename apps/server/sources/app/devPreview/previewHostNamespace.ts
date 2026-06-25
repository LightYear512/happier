import { createHmac } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import { resolveHostPreviewBaseDomain } from './hostPreviewBaseDomainResolution';
import type { PreviewRouteContext } from './previewRoutePaths';

const HOST_LABEL_PREFIX = 'hp';
const MAX_DNS_LABEL_LENGTH = 63;
const MAX_DNS_HOSTNAME_LENGTH = 253;
const PREVIEW_HOST_ID_LENGTH = 26;
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function readBaseDomain(env: NodeJS.ProcessEnv): string | null {
  const resolution = resolveHostPreviewBaseDomain(env);
  return resolution.enabled ? resolution.baseDomain : null;
}

function isValidBaseDomain(value: string): boolean {
  if (!value || value.length > MAX_DNS_HOSTNAME_LENGTH) {
    return false;
  }
  if (/[:/\\\s]/.test(value)) {
    return false;
  }
  const labels = value.split('.');
  if (labels.some((label) => !DNS_LABEL_PATTERN.test(label))) {
    return false;
  }
  return true;
}

function encodeBase32(bytes: Uint8Array): string {
  let encoded = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += BASE32_ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    encoded += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }
  return encoded;
}

function normalizeHostHeader(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
}

function firstHeaderValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return undefined;
  }
  const first = raw.split(',')[0]?.trim();
  return first ? first : undefined;
}

export function resolvePreviewHostBaseDomain(env: NodeJS.ProcessEnv = process.env): string | null {
  return readBaseDomain(env);
}

export function resolveSuggestedPreviewHostBaseDomain(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.HAPPIER_PUBLIC_SERVER_URL ?? '').trim();
  if (!raw) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname || hostname === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
    return null;
  }
  return isValidBaseDomain(hostname) ? hostname : null;
}

export function resolvePreviewHostHeader(headers: IncomingHttpHeaders | Record<string, unknown> | undefined): string | undefined {
  return firstHeaderValue(headers?.['x-forwarded-host']) ?? firstHeaderValue(headers?.host);
}

function requirePreviewHostSecret(env: NodeJS.ProcessEnv): string | null {
  const secret = (env.HANDY_MASTER_SECRET ?? '').trim();
  return secret ? secret : null;
}

export function buildPreviewHostId(
  context: PreviewRouteContext,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const secret = requirePreviewHostSecret(env);
  if (!secret) {
    return null;
  }
  const hmac = createHmac('sha256', secret);
  hmac.update('preview-host-v1');
  hmac.update('\0');
  hmac.update(context.sessionId);
  hmac.update('\0');
  hmac.update(context.machineId);
  hmac.update('\0');
  hmac.update(context.routeKey);
  return encodeBase32(hmac.digest()).slice(0, PREVIEW_HOST_ID_LENGTH);
}

export function buildHostNamespacePreviewHost(
  context: PreviewRouteContext,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const baseDomain = readBaseDomain(env);
  if (!baseDomain) {
    return null;
  }
  const hostId = buildPreviewHostId(context, env);
  if (!hostId) {
    return null;
  }
  const label = `${HOST_LABEL_PREFIX}-${hostId}`;
  return label.length <= MAX_DNS_LABEL_LENGTH ? `${label}.${baseDomain}` : null;
}

export function parseHostNamespacePreviewHost(
  hostHeader: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { hostId: string; baseDomain: string } | null {
  const baseDomain = readBaseDomain(env);
  if (!baseDomain || typeof hostHeader !== 'string') {
    return null;
  }

  const host = normalizeHostHeader(hostHeader);
  const suffix = `.${baseDomain}`;
  if (!host.endsWith(suffix)) {
    return null;
  }

  const labels = host.slice(0, -suffix.length).split('.').filter(Boolean);
  if (labels.length !== 1) {
    return null;
  }
  const [label] = labels;
  const prefix = `${HOST_LABEL_PREFIX}-`;
  if (!label?.startsWith(prefix)) {
    return null;
  }
  const hostId = label.slice(prefix.length);
  return /^[a-z2-7]{26}$/.test(hostId) ? { hostId, baseDomain } : null;
}

export function parseHostNamespacePreviewContext(
  hostHeader: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PreviewRouteContext | null {
  return null;
}
