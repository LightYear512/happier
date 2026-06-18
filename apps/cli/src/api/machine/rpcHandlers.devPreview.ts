import { Buffer } from 'node:buffer';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
  DaemonSessionDevPreviewCloseRequestSchema,
  DaemonSessionDevPreviewHttpRequestSchema,
  type DaemonSessionDevPreviewHttpErrorCode,
  type DaemonSessionDevPreviewHttpResponse,
} from '@happier-dev/protocol';

import type { SessionDevPreviewRegistry } from '@/session/devPreview/createSessionDevPreviewRegistry';
import { getSharedSessionDevPreviewRegistry } from '@/session/devPreview/sharedSessionDevPreviewRegistry';

import type { RpcHandlerManager } from '../rpc/RpcHandlerManager';

const REQUEST_HEADER_DENYLIST = new Set([
  'accept',
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

function err(errorCode: DaemonSessionDevPreviewHttpErrorCode, error?: string): DaemonSessionDevPreviewHttpResponse {
  return {
    ok: false,
    errorCode,
    error: error ?? errorCode,
  };
}

function readHttpTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = (env.HAPPIER_SESSION_DEV_PREVIEW_HTTP_TIMEOUT_MS ?? '').trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    return 15_000;
  }
  return Math.min(parsed, 120_000);
}

function sanitizeRequestHeaders(input: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'accept-encoding': 'identity',
  };

  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim().toLowerCase();
    const value = String(rawValue ?? '').trim();
    if (!name || !value || REQUEST_HEADER_DENYLIST.has(name)) {
      continue;
    }
    headers[name] = value;
  }

  return headers;
}

function sanitizeResponseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, rawName) => {
    const name = rawName.trim().toLowerCase();
    if (!name || RESPONSE_HEADER_DENYLIST.has(name)) {
      return;
    }
    headers[name] = value;
  });
  return headers;
}

function buildPreviewUrl(params: Readonly<{
  port: number;
  path: string;
  search?: string;
}>): URL {
  const url = new URL(`http://127.0.0.1:${params.port}/`);
  url.pathname = params.path.startsWith('/') ? params.path : `/${params.path}`;
  url.search = params.search ?? '';
  return url;
}

export function registerMachineDevPreviewRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerManager;
  registry?: SessionDevPreviewRegistry;
  deps?: Readonly<{
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  }>;
}>): void {
  const rpcHandlerManager = params.rpcHandlerManager;
  const registry = params.registry ?? getSharedSessionDevPreviewRegistry();
  const env = params.deps?.env ?? process.env;
  const fetchImpl = params.deps?.fetchImpl ?? fetch;
  const timeoutMs = readHttpTimeoutMs(env);

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP, async (raw: unknown) => {
    const parsed = DaemonSessionDevPreviewHttpRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return err('preview_invalid_request');
    }

    const preview = registry.getByRouteKey(parsed.data.routeKey);
    if (!preview) {
      return err('preview_not_found');
    }
    if (preview.sessionId !== parsed.data.sessionId || preview.machineId !== parsed.data.machineId) {
      return err('preview_not_found');
    }
    if (preview.health.status === 'dead') {
      return err('preview_dead');
    }

    const requestUrl = buildPreviewUrl({
      port: preview.port,
      path: parsed.data.path,
      search: parsed.data.search,
    });
    const requestHeaders = sanitizeRequestHeaders(parsed.data.headers);
    const body =
      typeof parsed.data.bodyBase64 === 'string'
        ? Buffer.from(parsed.data.bodyBase64, 'base64')
        : undefined;

    try {
      const response = await fetchImpl(requestUrl, {
        method: parsed.data.method,
        headers: requestHeaders,
        ...(body ? { body } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseHeaders = sanitizeResponseHeaders(response);
      const responseBody = parsed.data.method === 'HEAD'
        ? undefined
        : Buffer.from(await response.arrayBuffer()).toString('base64');

      return {
        ok: true,
        status: response.status,
        headers: responseHeaders,
        ...(responseBody ? { bodyBase64: responseBody } : {}),
      } satisfies DaemonSessionDevPreviewHttpResponse;
    } catch (error) {
      return err('preview_unreachable', error instanceof Error ? error.message : 'preview_unreachable');
    }
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_CLOSE, async (raw: unknown) => {
    const parsed = DaemonSessionDevPreviewCloseRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        errorCode: 'preview_invalid_request',
        error: 'preview_invalid_request',
      };
    }

    return {
      ok: true,
      ...registry.close({
        sessionId: parsed.data.sessionId,
        machineId: parsed.data.machineId,
        resourceId: parsed.data.resourceId,
      }),
    };
  });
}
