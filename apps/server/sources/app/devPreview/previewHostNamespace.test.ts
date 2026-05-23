import { describe, expect, it } from 'vitest';

import {
  buildHostNamespacePreviewHost,
  parseHostNamespacePreviewContext,
  resolvePreviewHostBaseDomain,
  resolvePreviewHostHeader,
} from './previewHostNamespace';

const routeContext = {
  sessionId: 'session_123',
  machineId: 'machine_abc',
  routeKey: 'route/main',
};

describe('previewHostNamespace', () => {
  it('round trips a preview route context through a host namespace', () => {
    const env = {
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: '.Preview.Example.Test.',
    };

    const host = buildHostNamespacePreviewHost(routeContext, env);

    expect(host).toMatch(/\.preview\.example\.test$/);
    expect(parseHostNamespacePreviewContext(`${host}:443`, env)).toEqual(routeContext);
  });

  it('rejects invalid base domains so callers can fall back to path namespaces', () => {
    for (const value of [
      'https://preview.example.test',
      'preview.example.test:443',
      'preview..example.test',
      'preview_bad.example.test',
      '-preview.example.test',
      'preview-.example.test',
    ]) {
      const env = { HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: value };

      expect(resolvePreviewHostBaseDomain(env)).toBeNull();
      expect(buildHostNamespacePreviewHost(routeContext, env)).toBeNull();
      expect(parseHostNamespacePreviewContext('anything.example.test', env)).toBeNull();
    }
  });

  it('resolves proxied host headers before direct host headers', () => {
    expect(resolvePreviewHostHeader({
      host: 'internal.example.test',
      'x-forwarded-host': 'preview.example.test, fallback.example.test',
    })).toBe('preview.example.test');
    expect(resolvePreviewHostHeader({
      host: 'direct.example.test',
    })).toBe('direct.example.test');
  });
});
