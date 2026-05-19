export type PreviewRouteContext = Readonly<{
  sessionId: string;
  machineId: string;
  routeKey: string;
}>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

function normalizeHostname(hostname: string): string {
  const lowered = hostname.trim().toLowerCase();
  if (lowered.startsWith('[') && lowered.endsWith(']')) {
    return lowered.slice(1, -1);
  }
  return lowered;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return LOOPBACK_HOSTS.has(normalized) || normalized === '0:0:0:0:0:0:0:1';
}

function hasBlockedScheme(value: string): boolean {
  return /^(?:data|blob|file|javascript|mailto|tel|about):/i.test(value);
}

function buildPreviewPathFromUrl(url: URL, basePath: string): string {
  const path = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
  return `${basePath}${path}${url.search}${url.hash}`;
}

export function buildPreviewRouteBasePath(context: PreviewRouteContext): string {
  return `/preview/${encodeURIComponent(context.sessionId)}/${encodeURIComponent(context.machineId)}/${encodeURIComponent(context.routeKey)}/`;
}

export function rewritePreviewUrlValue(
  value: string,
  context: PreviewRouteContext,
): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#') || hasBlockedScheme(trimmed)) {
    return null;
  }

  const basePath = buildPreviewRouteBasePath(context);
  if (trimmed.startsWith(basePath)) {
    return null;
  }

  if (trimmed.startsWith('//')) {
    let parsed: URL;
    try {
      parsed = new URL(`http:${trimmed}`);
    } catch {
      return null;
    }
    if (!isLoopbackHost(parsed.hostname)) {
      return null;
    }
    return buildPreviewPathFromUrl(parsed, basePath);
  }

  if (trimmed.startsWith('/')) {
    const parsed = new URL(trimmed, 'https://preview.invalid');
    return buildPreviewPathFromUrl(parsed, basePath);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    return null;
  }
  if (!isLoopbackHost(parsed.hostname)) {
    return null;
  }
  if (parsed.pathname.startsWith(basePath)) {
    return null;
  }

  return buildPreviewPathFromUrl(parsed, basePath);
}

export function rewritePreviewSrcSetValue(
  value: string,
  context: PreviewRouteContext,
): string {
  return value
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) {
        return trimmed;
      }
      const firstWhitespace = trimmed.search(/\s/);
      const rawUrl = firstWhitespace === -1 ? trimmed : trimmed.slice(0, firstWhitespace);
      const descriptor = firstWhitespace === -1 ? '' : trimmed.slice(firstWhitespace);
      const rewritten = rewritePreviewUrlValue(rawUrl, context);
      return rewritten ? `${rewritten}${descriptor}` : trimmed;
    })
    .join(', ');
}
