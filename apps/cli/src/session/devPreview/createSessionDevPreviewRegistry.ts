import type { LocalServicePreviewV1 } from '@happier-dev/protocol';

import { checkSessionDevPreviewHealth } from './createSessionDevPreviewHealthChecker';
import {
  normalizeDevPreviewRegistration,
  type SessionDevPreviewRegistrationInput,
} from './normalizeDevPreviewRegistration';

type SessionDevPreviewRegistryEntry = Readonly<{
  payload: LocalServicePreviewV1;
  compositeKey: string;
}>;

export type SessionDevPreviewRegistry = Readonly<{
  register: (input: SessionDevPreviewRegistrationInput) => Promise<LocalServicePreviewV1>;
  getByResourceId: (resourceId: string) => LocalServicePreviewV1 | null;
  getByRouteKey: (routeKey: string) => LocalServicePreviewV1 | null;
}>;

export function createSessionDevPreviewRegistry(params?: Readonly<{ healthCheckTimeoutMs?: number }>): SessionDevPreviewRegistry {
  const byCompositeKey = new Map<string, SessionDevPreviewRegistryEntry>();
  const byResourceId = new Map<string, SessionDevPreviewRegistryEntry>();
  const routeKeyToResourceId = new Map<string, string>();

  return {
    register: async (input) => {
      const normalized = normalizeDevPreviewRegistration(input);
      const previous = byCompositeKey.get(normalized.compositeKey)?.payload ?? null;
      const health = await checkSessionDevPreviewHealth({
        port: normalized.port,
        timeoutMs: params?.healthCheckTimeoutMs,
      });

      const payload: LocalServicePreviewV1 = {
        resourceId: previous?.resourceId ?? normalized.resourceId,
        sessionId: normalized.sessionId,
        machineId: normalized.machineId,
        port: normalized.port,
        origin: normalized.origin,
        ...(normalized.url ? { url: normalized.url } : {}),
        ...(normalized.name ? { name: normalized.name } : {}),
        ...(normalized.framework ? { framework: normalized.framework } : {}),
        source: normalized.source,
        registeredAtMs: previous?.registeredAtMs ?? normalized.registeredAtMs,
        health,
        preview: {
          rewriteUrls: normalized.rewriteUrls,
          supportsWebSocket: true,
          routeKey: previous?.preview.routeKey ?? normalized.routeKey,
          initialPath: normalized.initialPath,
        },
      };

      const entry: SessionDevPreviewRegistryEntry = {
        payload,
        compositeKey: normalized.compositeKey,
      };
      byCompositeKey.set(normalized.compositeKey, entry);
      byResourceId.set(payload.resourceId, entry);
      routeKeyToResourceId.set(payload.preview.routeKey, payload.resourceId);
      return payload;
    },
    getByResourceId: (resourceId) => byResourceId.get(String(resourceId).trim())?.payload ?? null,
    getByRouteKey: (routeKey) => {
      const resourceId = routeKeyToResourceId.get(String(routeKey).trim());
      return resourceId ? byResourceId.get(resourceId)?.payload ?? null : null;
    },
  };
}
