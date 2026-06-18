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
  list: (input: Readonly<{ sessionId: string; machineId?: string }>) => LocalServicePreviewV1[];
  close: (input: Readonly<{ sessionId: string; machineId?: string; resourceId: string }>) => Readonly<{
    closed: boolean;
    preview: LocalServicePreviewV1 | null;
  }>;
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
    list: (input) => {
      const sessionId = String(input.sessionId).trim();
      const machineId = typeof input.machineId === 'string' ? input.machineId.trim() : '';
      return [...byResourceId.values()]
        .map((entry) => entry.payload)
        .filter((preview) => preview.sessionId === sessionId)
        .filter((preview) => !machineId || preview.machineId === machineId)
        .sort((a, b) => a.registeredAtMs - b.registeredAtMs || a.resourceId.localeCompare(b.resourceId));
    },
    close: (input) => {
      const sessionId = String(input.sessionId).trim();
      const machineId = typeof input.machineId === 'string' ? input.machineId.trim() : '';
      const resourceId = String(input.resourceId).trim();
      const entry = byResourceId.get(resourceId);
      if (!entry || entry.payload.sessionId !== sessionId || (machineId && entry.payload.machineId !== machineId)) {
        return { closed: false, preview: null };
      }
      byResourceId.delete(resourceId);
      byCompositeKey.delete(entry.compositeKey);
      routeKeyToResourceId.delete(entry.payload.preview.routeKey);
      return { closed: true, preview: entry.payload };
    },
    getByResourceId: (resourceId) => byResourceId.get(String(resourceId).trim())?.payload ?? null,
    getByRouteKey: (routeKey) => {
      const resourceId = routeKeyToResourceId.get(String(routeKey).trim());
      return resourceId ? byResourceId.get(resourceId)?.payload ?? null : null;
    },
  };
}
