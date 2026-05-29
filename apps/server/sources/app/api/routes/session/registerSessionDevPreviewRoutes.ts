import { z } from 'zod';

import { createServerFeatureGatePreHandler } from '@/app/features/catalog/serverFeatureGate';
import {
  type PreviewNamespaceStrategy,
} from '@/app/devPreview/previewRoutePaths';
import { readSessionDevPreviewFeatureEnv } from '@/app/features/catalog/readFeatureEnv';
import {
  hasOwnerPreviewAccess,
} from '@/app/devPreview/sessionDevPreviewRequestAuth';
import {
  buildHostNamespacePreviewUrl,
  buildPathNamespacePreviewUrl,
  isSessionDevPreviewRelayPolicyAllowed,
  relaySessionDevPreviewHttpRequest,
} from '@/app/api/devPreview/sessionDevPreviewHttpRelay';

import { type Fastify } from '../../types';
import { registerSessionDevPreviewWebSocketRelay } from './registerSessionDevPreviewWebSocketRelay';
import {
  createSessionDevPreviewToken,
} from '@/app/api/devPreview/sessionDevPreviewToken';

const tokenParamsSchema = z.object({
  sessionId: z.string().min(1),
  machineId: z.string().min(1),
  routeKey: z.string().min(1),
});

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

function registerPreviewRelayRoute(
  app: Fastify,
  url: string,
  preHandler: ReturnType<typeof createServerFeatureGatePreHandler>,
  namespaceStrategy: PreviewNamespaceStrategy,
  methods: PreviewRelayHttpMethod[] = PREVIEW_RELAY_HTTP_METHODS,
): void {
  const handler = async (request: any, reply: any) => await relaySessionDevPreviewHttpRequest(app, request, reply, namespaceStrategy);
  const routeCapableApp = app as unknown as PreviewRelayRouteCapableApp;
  const routeRegistrar = routeCapableApp.route;
  if (typeof routeRegistrar === 'function') {
    const registerRoute = routeRegistrar as PreviewRelayRouteRegistrar;
    registerRoute.call(app, {
      method: methods,
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
  const pathModeGate = async (_request: any, reply: any) => {
    const featureConfig = readSessionDevPreviewFeatureEnv(process.env);
    if (!featureConfig.pathEnabled) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return undefined;
  };
  const tokenGate = async (_request: any, reply: any) => {
    if (!isSessionDevPreviewRelayPolicyAllowed(process.env)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const featureConfig = readSessionDevPreviewFeatureEnv(process.env);
    if (!featureConfig.featureToggleEnabled) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!featureConfig.relayEnabled) {
      return reply.code(503).send({
        error: 'preview-relay-unavailable',
        suggestedBaseDomain: featureConfig.suggestedHostBaseDomain,
      });
    }
    return undefined;
  };
  registerSessionDevPreviewWebSocketRelay(app);

  app.post(
    '/v1/sessions/:sessionId/dev-preview/:machineId/:routeKey/token',
    {
      preHandler: [tokenGate, app.authenticate],
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
      const hostPreviewUrl = buildHostNamespacePreviewUrl({
        request,
        routeContext,
        previewToken: token,
      });
      if (!hostPreviewUrl && !readSessionDevPreviewFeatureEnv(process.env).pathEnabled) {
        return reply.code(503).send({ error: 'preview-relay-unavailable' });
      }
      reply.header('cache-control', 'no-store');
      return reply.send({
        token,
        namespaceStrategy: hostPreviewUrl ? 'host' : 'path',
        previewUrl: hostPreviewUrl ?? buildPathNamespacePreviewUrl({
          request,
          routeContext,
          previewToken: token,
        }),
      });
    },
  );

  registerPreviewRelayRoute(app, '/preview/:sessionId/:machineId/:routeKey', async (request, reply) => {
    const featureGateResult = await featureGate(request, reply);
    if (typeof featureGateResult !== 'undefined') return featureGateResult;
    return await pathModeGate(request, reply);
  }, 'path');
  registerPreviewRelayRoute(app, '/preview/:sessionId/:machineId/:routeKey/*', async (request, reply) => {
    const featureGateResult = await featureGate(request, reply);
    if (typeof featureGateResult !== 'undefined') return featureGateResult;
    return await pathModeGate(request, reply);
  }, 'path');
}
