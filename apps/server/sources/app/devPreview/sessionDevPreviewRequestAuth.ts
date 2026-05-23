import { db } from '@/storage/db';

const PREVIEW_TOKEN_COOKIE_NAME = 'happier_dev_preview_token';

export async function hasOwnerPreviewAccess(params: Readonly<{
  userId: string;
  sessionId: string;
  machineId: string;
}>): Promise<boolean> {
  const session = await db.session.findUnique({
    where: { id: params.sessionId },
    select: { accountId: true },
  });
  if (!session || session.accountId !== params.userId) {
    return false;
  }

  const accessKey = await db.accessKey.findUnique({
    where: {
      accountId_machineId_sessionId: {
        accountId: params.userId,
        machineId: params.machineId,
        sessionId: params.sessionId,
      },
    },
    select: { id: true },
  });
  return !!accessKey;
}

function parseCookies(rawCookieHeader: string | undefined): Record<string, string> {
  if (typeof rawCookieHeader !== 'string' || rawCookieHeader.trim().length === 0) {
    return {};
  }

  const cookies: Record<string, string> = {};
  for (const entry of rawCookieHeader.split(';')) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = entry.slice(0, separatorIndex).trim();
    const rawValue = entry.slice(separatorIndex + 1).trim();
    if (!name || !rawValue) {
      continue;
    }
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      continue;
    }
  }
  return cookies;
}

function decodeQueryKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    return rawKey;
  }
}

function stripPreviewTokenFromRawSearch(rawSearch: string): string {
  if (!rawSearch.startsWith('?')) {
    return '';
  }
  const entries = rawSearch.slice(1).split('&').filter((entry) => {
    const separatorIndex = entry.indexOf('=');
    const rawKey = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex);
    return decodeQueryKey(rawKey) !== 'previewToken';
  });
  return entries.length > 0 ? `?${entries.join('&')}` : '';
}

export function parsePreviewTokenFromRequest(request: {
  raw?: { url?: string | undefined } | undefined;
  url?: string | undefined;
  headers?: Record<string, unknown> | undefined;
}) {
  const rawUrl = request.raw?.url ?? request.url ?? '/';
  const parsed = new URL(rawUrl, 'http://127.0.0.1');
  const previewToken = parsed.searchParams.get('previewToken');
  const cookies = parseCookies(typeof request.headers?.cookie === 'string' ? request.headers.cookie : undefined);
  const fallbackPreviewToken = cookies[PREVIEW_TOKEN_COOKIE_NAME] ?? null;
  const normalizedPreviewToken =
    typeof previewToken === 'string' && previewToken.trim().length > 0
      ? previewToken.trim()
      : typeof fallbackPreviewToken === 'string' && fallbackPreviewToken.trim().length > 0
        ? fallbackPreviewToken.trim()
        : null;
  return {
    previewToken: normalizedPreviewToken,
    previewTokenSource: typeof previewToken === 'string' && previewToken.trim().length > 0 ? 'query' : normalizedPreviewToken ? 'cookie' : 'missing',
    forwardedSearch: stripPreviewTokenFromRawSearch(parsed.search),
  } as const;
}

export function isSecureRequest(request: {
  headers?: Record<string, unknown> | undefined;
  protocol?: string | undefined;
  raw?: { socket?: { encrypted?: boolean | undefined } | undefined } | undefined;
}): boolean {
  const forwardedProto = typeof request.headers?.['x-forwarded-proto'] === 'string'
    ? request.headers['x-forwarded-proto'].trim().toLowerCase()
    : '';
  if (forwardedProto === 'https') {
    return true;
  }
  if (typeof request.protocol === 'string' && request.protocol.trim().toLowerCase() === 'https') {
    return true;
  }
  return request.raw?.socket?.encrypted === true;
}

export function buildPreviewTokenCookieHeader(params: Readonly<{
  previewToken: string;
  cookiePath: string;
  maxAgeSeconds: number;
  secure: boolean;
}>): string {
  return [
    `${PREVIEW_TOKEN_COOKIE_NAME}=${encodeURIComponent(params.previewToken)}`,
    `Path=${params.cookiePath}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${params.maxAgeSeconds}`,
    params.secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}
