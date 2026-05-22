import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { createServerFeatureGatePreHandler } from '@/app/features/catalog/serverFeatureGate';
import { buildPreviewRouteBasePath, type PreviewRouteContext } from '@/app/devPreview/previewRoutePaths';
import {
  buildPreviewRuntimeLimitationDocument,
  PREVIEW_LIMITATION_DOCUMENT_CSP,
} from '@/app/devPreview/buildPreviewRuntimeLimitationDocument';
import { rewritePreviewResponseBody } from '@/app/devPreview/rewritePreviewResponseBody';
import { rewritePreviewContentSecurityPolicy } from '@/app/devPreview/rewritePreviewContentSecurityPolicy';
import {
  buildPreviewTokenCookieHeader,
  hasOwnerPreviewAccess,
  isSecureRequest,
  parsePreviewTokenFromRequest,
} from '@/app/devPreview/sessionDevPreviewRequestAuth';
import {
  DaemonSessionDevPreviewHttpResponseSchema,
} from '@happier-dev/protocol';
import { RPC_METHODS, RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';

import { type Fastify } from '../../types';
import { registerSessionDevPreviewWebSocketRelay } from './registerSessionDevPreviewWebSocketRelay';
import {
  createSessionDevPreviewToken,
  resolveSessionDevPreviewTokenTtlSeconds,
  verifySessionDevPreviewToken,
} from './sessionDevPreviewToken';

const tokenParamsSchema = z.object({
  sessionId: z.string().min(1),
  machineId: z.string().min(1),
  routeKey: z.string().min(1),
});

const previewParamsSchema = z.object({
  sessionId: z.string().min(1),
  machineId: z.string().min(1),
  routeKey: z.string().min(1),
  '*': z.string().optional(),
});

const REQUEST_HEADER_DENYLIST = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
]);

const RESPONSE_HEADER_DENYLIST = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];
type PreviewRelayHttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
const PREVIEW_RELAY_HTTP_METHODS: PreviewRelayHttpMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const PREVIEW_RELAY_FALLBACK_REGISTRARS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
type PreviewRelayFallbackRegistrar = (typeof PREVIEW_RELAY_FALLBACK_REGISTRARS)[number];
type PreviewRelayRouteHandler = (request: any, reply: any) => Promise<unknown>;
type PreviewRelayRouteRegistrar = (options: {
  method: PreviewRelayHttpMethod[];
  url: string;
  preHandler: ReturnType<typeof createServerFeatureGatePreHandler>;
  handler: PreviewRelayRouteHandler;
}) => unknown;
type PreviewRelayFallbackRouteRegistrar = (
  url: string,
  opts: { preHandler: ReturnType<typeof createServerFeatureGatePreHandler> },
  handler: PreviewRelayRouteHandler,
) => unknown;
type PreviewRelayRouteCapableApp = {
  route?: unknown;
} & Partial<Record<PreviewRelayFallbackRegistrar, unknown>>;

function shouldTreatAsHtml(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return HTML_CONTENT_TYPES.some((candidate) => normalized.includes(candidate));
}

function sanitizeIncomingHeaders(input: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim().toLowerCase();
    if (!name || REQUEST_HEADER_DENYLIST.has(name)) {
      continue;
    }
    if (Array.isArray(rawValue)) {
      const joined = rawValue.map((value) => String(value ?? '').trim()).filter(Boolean).join(', ');
      if (joined) {
        headers[name] = joined;
      }
      continue;
    }
    const value = String(rawValue ?? '').trim();
    if (!value) {
      continue;
    }
    headers[name] = value;
  }

  return headers;
}


function mapRelayFailureStatus(result: { errorCode?: string }): number {
  if (result.errorCode === 'preview_not_found') {
    return 404;
  }
  if (result.errorCode === 'preview_dead') {
    return 410;
  }
  return 502;
}

function mapForwardFailureStatus(result: { errorCode?: string }): number {
  if (result.errorCode === RPC_ERROR_CODES.METHOD_NOT_AVAILABLE) {
    return 503;
  }
  return 502;
}

function buildPreviewTokenScrubRedirectLocation(rawUrl: string): string {
  const parsed = new URL(rawUrl, 'http://happier-preview.local');
  parsed.searchParams.delete('previewToken');
  return `${parsed.pathname}${parsed.search}`;
}

function hasEncryptedSocket(request: { raw?: { socket?: unknown } }): boolean {
  const socket = request.raw?.socket;
  return typeof socket === 'object'
    && socket !== null
    && 'encrypted' in socket
    && socket.encrypted === true;
}

function resolveRequestOrigin(request: {
  headers?: Record<string, unknown>;
  protocol?: string;
  raw?: { socket?: unknown };
}): string {
  const forwardedHost = typeof request.headers?.['x-forwarded-host'] === 'string'
    ? request.headers['x-forwarded-host'].split(',')[0]?.trim()
    : '';
  const host = forwardedHost
    || (typeof request.headers?.host === 'string' ? request.headers.host.trim() : '')
    || '127.0.0.1';
  const forwardedProto = typeof request.headers?.['x-forwarded-proto'] === 'string'
    ? request.headers['x-forwarded-proto'].split(',')[0]?.trim().toLowerCase()
    : '';
  const protocol = forwardedProto
    || (typeof request.protocol === 'string' && request.protocol.trim()
      ? request.protocol.trim().toLowerCase()
      : hasEncryptedSocket(request) ? 'https' : 'http');
  return `${protocol}://${host}`;
}

function buildPathNamespacePreviewUrl(params: Readonly<{
  request: { headers?: Record<string, unknown>; protocol?: string; raw?: { socket?: unknown } };
  routeContext: PreviewRouteContext;
  previewToken: string;
}>): string {
  const url = new URL(buildPreviewRouteBasePath(params.routeContext), resolveRequestOrigin(params.request));
  url.searchParams.set('previewToken', params.previewToken);
  return url.toString();
}

function shouldUsePreviewTokenScrubRedirect(request: { headers?: Record<string, unknown>; method?: string }): boolean {
  if (!['GET', 'HEAD'].includes(String(request.method).toUpperCase())) {
    return false;
  }
  return !Object.keys(request.headers ?? {}).some((headerName) => headerName.toLowerCase().startsWith('sec-fetch-'));
}

async function relayPreviewRequest(
  app: Fastify,
  request: any,
  reply: any,
): Promise<unknown> {
  const parsedParams = previewParamsSchema.safeParse(request.params);
  if (!parsedParams.success) {
    return reply.code(404).send({ error: 'not_found' });
  }

  const { previewToken, previewTokenSource, forwardedSearch } = parsePreviewTokenFromRequest(request);
  if (!previewToken) {
    return reply.code(401).send({ error: 'invalid-preview-token' });
  }

  const verifiedToken = await verifySessionDevPreviewToken(previewToken);
  if (!verifiedToken) {
    return reply.code(401).send({ error: 'invalid-preview-token' });
  }

  const { sessionId, machineId, routeKey } = parsedParams.data;
  if (
    verifiedToken.sessionId !== sessionId
    || verifiedToken.machineId !== machineId
    || verifiedToken.routeKey !== routeKey
  ) {
    return reply.code(403).send({ error: 'preview-token-scope-mismatch' });
  }

  const hasAccess = await hasOwnerPreviewAccess({
    userId: verifiedToken.userId,
    sessionId,
    machineId,
  });
  if (!hasAccess) {
    return reply.code(404).send({ error: 'not_found' });
  }

  const routeContext = { sessionId, machineId, routeKey };
  const cookiePath = buildPreviewRouteBasePath(routeContext);
  if (previewTokenSource === 'query' && shouldUsePreviewTokenScrubRedirect(request)) {
    reply.header('set-cookie', buildPreviewTokenCookieHeader({
      previewToken,
      cookiePath,
      maxAgeSeconds: resolveSessionDevPreviewTokenTtlSeconds(process.env),
      secure: isSecureRequest(request),
    }));
    reply.header('cache-control', 'no-store');
    return reply.code(302).header('location', buildPreviewTokenScrubRedirectLocation(request.url)).send();
  }

  const pathTail = typeof parsedParams.data['*'] === 'string' && parsedParams.data['*'].trim().length > 0
    ? `/${parsedParams.data['*']}`
    : '/';
  const forwardResult = await app.forwardRpcForUser({
    userId: verifiedToken.userId,
    method: `${machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}`,
    params: {
      sessionId,
      machineId,
      routeKey,
      method: request.method,
      path: pathTail,
      search: forwardedSearch,
      headers: sanitizeIncomingHeaders(request.headers ?? {}),
      ...(Buffer.isBuffer(request.body)
        ? { bodyBase64: request.body.toString('base64') }
        : typeof request.body === 'string'
          ? { bodyBase64: Buffer.from(request.body, 'utf8').toString('base64') }
          : {}),
    },
  });

  if (!forwardResult.ok) {
    return reply.code(mapForwardFailureStatus(forwardResult)).send({ error: 'preview-relay-unavailable' });
  }

  const parsedRelay = DaemonSessionDevPreviewHttpResponseSchema.safeParse(forwardResult.result);
  if (!parsedRelay.success) {
    return reply.code(502).send({ error: 'invalid-preview-relay-response' });
  }

  if (!parsedRelay.data.ok) {
    return reply.code(mapRelayFailureStatus(parsedRelay.data)).send({ error: parsedRelay.data.errorCode });
  }

  if (previewTokenSource === 'query') {
    reply.header('set-cookie', buildPreviewTokenCookieHeader({
      previewToken,
      cookiePath,
      maxAgeSeconds: resolveSessionDevPreviewTokenTtlSeconds(process.env),
      secure: isSecureRequest(request),
    }));
  }
  const responseBodyBuffer =
    typeof parsedRelay.data.bodyBase64 === 'string'
      ? Buffer.from(parsedRelay.data.bodyBase64, 'base64')
      : Buffer.alloc(0);
  const contentTypeHeader = typeof parsedRelay.data.headers['content-type'] === 'string'
    ? parsedRelay.data.headers['content-type']
    : '';
  const isHtmlResponse = shouldTreatAsHtml(contentTypeHeader);
  let runtimeScriptNonce: string | null = null;
  let rewrittenCspHeaderValues: string[] | null = null;

  if (isHtmlResponse) {
    const currentCspHeader = typeof parsedRelay.data.headers['content-security-policy'] === 'string'
      ? parsedRelay.data.headers['content-security-policy']
      : null;
    const cspNonce = randomBytes(16).toString('base64');
    const cspRewrite = rewritePreviewContentSecurityPolicy({
      headerValues: currentCspHeader ? [currentCspHeader] : [],
      nonce: cspNonce,
    });
    if (cspRewrite.mode === 'blocked') {
      reply.header('content-type', 'text/html; charset=utf-8');
      reply.header('content-security-policy', PREVIEW_LIMITATION_DOCUMENT_CSP);
      reply.header('x-happier-preview-runtime-mode', 'csp-blocked');
      return reply.send(Buffer.from(buildPreviewRuntimeLimitationDocument({
        reason: cspRewrite.reason,
      }), 'utf8'));
    }
    reply.header('x-happier-preview-runtime-mode', 'inject');
    rewrittenCspHeaderValues = cspRewrite.headerValues;
    runtimeScriptNonce = currentCspHeader ? cspNonce : null;
  }

  for (const [rawName, rawValue] of Object.entries(parsedRelay.data.headers)) {
    const name = rawName.trim().toLowerCase();
    if (!name || RESPONSE_HEADER_DENYLIST.has(name)) {
      continue;
    }
    if (name === 'content-security-policy' && rewrittenCspHeaderValues) {
      reply.header(name, rewrittenCspHeaderValues.length === 1 ? rewrittenCspHeaderValues[0]! : rewrittenCspHeaderValues);
      continue;
    }
    reply.header(name, rawValue);
  }

  reply.code(parsedRelay.data.status);
  if (request.method === 'HEAD') {
    return reply.send();
  }

  const rewrittenBody = rewritePreviewResponseBody({
    contentType: contentTypeHeader,
    body: responseBodyBuffer.toString('utf8'),
    routeContext,
    previewToken,
    runtimeScriptNonce,
  });
  const bodyToSend = rewrittenBody === responseBodyBuffer.toString('utf8')
    ? responseBodyBuffer
    : Buffer.from(rewrittenBody, 'utf8');

  return reply.send(bodyToSend);
}

function registerPreviewRelayRoute(
  app: Fastify,
  url: string,
  preHandler: ReturnType<typeof createServerFeatureGatePreHandler>,
): void {
  const handler = async (request: any, reply: any) => await relayPreviewRequest(app, request, reply);
  const routeCapableApp = app as unknown as PreviewRelayRouteCapableApp;
  const routeRegistrar = routeCapableApp.route;
  if (typeof routeRegistrar === 'function') {
    const registerRoute = routeRegistrar as PreviewRelayRouteRegistrar;
    registerRoute.call(app, {
      method: PREVIEW_RELAY_HTTP_METHODS,
      url,
      preHandler,
      handler,
    });
    return;
  }

  for (const method of PREVIEW_RELAY_FALLBACK_REGISTRARS) {
    const registrar = routeCapableApp[method];
    if (typeof registrar === 'function') {
      const registerFallbackRoute = registrar as PreviewRelayFallbackRouteRegistrar;
      registerFallbackRoute.call(app, url, { preHandler }, handler);
    }
  }
}

export function registerSessionDevPreviewRoutes(app: Fastify): void {
  const featureGate = createServerFeatureGatePreHandler('sessions.devPreview.relay');
  registerSessionDevPreviewWebSocketRelay(app);

  app.post(
    '/v1/sessions/:sessionId/dev-preview/:machineId/:routeKey/token',
    {
      preHandler: [featureGate, app.authenticate],
      schema: {
        params: tokenParamsSchema,
      },
    },
    async (request, reply) => {
      const parsedParams = tokenParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const { sessionId, machineId, routeKey } = parsedParams.data;
      const hasAccess = await hasOwnerPreviewAccess({
        userId: request.userId,
        sessionId,
        machineId,
      });
      if (!hasAccess) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const token = await createSessionDevPreviewToken({
        userId: request.userId,
        sessionId,
        machineId,
        routeKey,
      });
      const routeContext = { sessionId, machineId, routeKey };
      reply.header('cache-control', 'no-store');
      return reply.send({
        token,
        namespaceStrategy: 'path',
        previewUrl: buildPathNamespacePreviewUrl({
          request,
          routeContext,
          previewToken: token,
        }),
      });
    },
  );

  registerPreviewRelayRoute(app, '/preview/:sessionId/:machineId/:routeKey', featureGate);
  registerPreviewRelayRoute(app, '/preview/:sessionId/:machineId/:routeKey/*', featureGate);
}
