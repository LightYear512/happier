import { Buffer } from 'node:buffer';
import type { IncomingHttpHeaders } from 'node:http';

import type { PreviewRouteContext } from './previewRoutePaths';

const HOST_LABEL_PREFIX = 'hp';
const MAX_DNS_LABEL_LENGTH = 63;
const MAX_DNS_HOSTNAME_LENGTH = 253;
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function readBaseDomain(env: NodeJS.ProcessEnv): string | null {
  const raw = (env.HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN ?? '').trim().toLowerCase();
  if (!raw) {
    return null;
  }
  const normalized = raw.replace(/^\.+|\.+$/g, '');
  if (!isValidBaseDomain(normalized)) {
    return null;
  }
  return normalized;
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

function encodeLabel(value: string): string | null {
  const bytes = Buffer.from(value, 'utf8');
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
  const label = `${HOST_LABEL_PREFIX}-${encoded}`;
  return label.length <= MAX_DNS_LABEL_LENGTH ? label : null;
}

function decodeLabel(value: string): string | null {
  if (!value.startsWith(`${HOST_LABEL_PREFIX}-`)) {
    return null;
  }
  try {
    let buffer = 0;
    let bits = 0;
    const bytes: number[] = [];
    for (const char of value.slice(HOST_LABEL_PREFIX.length + 1)) {
      const index = BASE32_ALPHABET.indexOf(char);
      if (index < 0) {
        return null;
      }
      buffer = (buffer << 5) | index;
      bits += 5;
      if (bits >= 8) {
        bytes.push((buffer >> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return null;
  }
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

export function resolvePreviewHostHeader(headers: IncomingHttpHeaders | Record<string, unknown> | undefined): string | undefined {
  return firstHeaderValue(headers?.['x-forwarded-host']) ?? firstHeaderValue(headers?.host);
}

export function buildHostNamespacePreviewHost(
  context: PreviewRouteContext,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const baseDomain = readBaseDomain(env);
  if (!baseDomain) {
    return null;
  }
  const sessionLabel = encodeLabel(context.sessionId);
  const machineLabel = encodeLabel(context.machineId);
  const routeLabel = encodeLabel(context.routeKey);
  if (!sessionLabel || !machineLabel || !routeLabel) {
    return null;
  }
  return `${routeLabel}.${machineLabel}.${sessionLabel}.${baseDomain}`;
}

export function parseHostNamespacePreviewContext(
  hostHeader: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PreviewRouteContext | null {
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
  if (labels.length !== 3) {
    return null;
  }

  const [routeLabel, machineLabel, sessionLabel] = labels;
  const routeKey = decodeLabel(routeLabel);
  const machineId = decodeLabel(machineLabel);
  const sessionId = decodeLabel(sessionLabel);
  if (!routeKey || !machineId || !sessionId) {
    return null;
  }
  return { sessionId, machineId, routeKey };
}
