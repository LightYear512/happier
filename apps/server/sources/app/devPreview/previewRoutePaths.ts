export type PreviewRouteContext = Readonly<{
  sessionId: string;
  machineId: string;
  routeKey: string;
}>;

export type PreviewNamespaceStrategy = 'path' | 'host';

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

function appendPreviewTokenToSearch(search: string, previewToken?: string | null): string {
  if (typeof previewToken === 'string' && previewToken.trim().length > 0) {
    const separator = search.length > 0 ? '&' : '?';
    return `${search}${separator}previewToken=${encodeURIComponent(previewToken.trim())}`;
  }
  return search;
}

function buildPreviewPathFromUrl(url: URL, basePath: string, previewToken?: string | null): string {
  const path = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
  const search = appendPreviewTokenToSearch(url.search, previewToken);
  return `${basePath}${path}${search}${url.hash}`;
}

function buildHostPreviewPathFromUrl(url: URL, previewToken?: string | null): string {
  const search = appendPreviewTokenToSearch(url.search, previewToken);
  return `${url.pathname}${search}${url.hash}`;
}

export function buildPreviewRouteBasePath(context: PreviewRouteContext): string {
  return `/preview/${encodeURIComponent(context.sessionId)}/${encodeURIComponent(context.machineId)}/${encodeURIComponent(context.routeKey)}/`;
}

export function rewritePreviewUrlValue(
  value: string,
  context: PreviewRouteContext,
  previewToken?: string | null,
  namespaceStrategy: PreviewNamespaceStrategy = 'path',
): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#') || hasBlockedScheme(trimmed)) {
    return null;
  }

  const basePath = buildPreviewRouteBasePath(context);
  if (namespaceStrategy === 'path' && trimmed.startsWith(basePath)) {
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
    return namespaceStrategy === 'host'
      ? buildHostPreviewPathFromUrl(parsed, previewToken)
      : buildPreviewPathFromUrl(parsed, basePath, previewToken);
  }

  if (trimmed.startsWith('/')) {
    const parsed = new URL(trimmed, 'https://preview.invalid');
    return namespaceStrategy === 'host'
      ? buildHostPreviewPathFromUrl(parsed, previewToken)
      : buildPreviewPathFromUrl(parsed, basePath, previewToken);
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
  if (namespaceStrategy === 'path' && parsed.pathname.startsWith(basePath)) {
    return null;
  }

  return namespaceStrategy === 'host'
    ? buildHostPreviewPathFromUrl(parsed, previewToken)
    : buildPreviewPathFromUrl(parsed, basePath, previewToken);
}

export function rewritePreviewSrcSetValue(
  value: string,
  context: PreviewRouteContext,
  previewToken?: string | null,
  namespaceStrategy: PreviewNamespaceStrategy = 'path',
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
      const rewritten = rewritePreviewUrlValue(rawUrl, context, previewToken, namespaceStrategy);
      return rewritten ? `${rewritten}${descriptor}` : trimmed;
    })
    .join(', ');
}
