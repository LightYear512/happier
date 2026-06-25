import { describe, expect, it } from 'vitest';

import {
  buildHostNamespacePreviewHost,
  buildPreviewHostId,
  parseHostNamespacePreviewContext,
  parseHostNamespacePreviewHost,
  resolvePreviewHostBaseDomain,
  resolvePreviewHostHeader,
  resolveSuggestedPreviewHostBaseDomain,
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
      HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.test',
      HANDY_MASTER_SECRET: 'preview-host-secret',
    };

    const host = buildHostNamespacePreviewHost(routeContext, env);

    expect(host).toMatch(/^hp-[a-z2-7]{26}\.preview\.example\.test$/);
    expect(parseHostNamespacePreviewHost(`${host}:443`, env)).toEqual({
      hostId: buildPreviewHostId(routeContext, env),
      baseDomain: 'preview.example.test',
    });
    expect(parseHostNamespacePreviewContext(`${host}:443`, env)).toBeNull();
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
      expect(parseHostNamespacePreviewHost('hp-abcdefghijklmnopqrstuvwxyz.preview.example.test', env)).toBeNull();
      expect(parseHostNamespacePreviewContext('anything.example.test', env)).toBeNull();
    }
  });

  it('builds host namespace from a derived same-site web URL', () => {
    const env = {
      HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1.nip.io:3005',
      HANDY_MASTER_SECRET: 'preview-host-secret',
    };

    const host = buildHostNamespacePreviewHost(routeContext, env);

    expect(host).toMatch(/^hp-[a-z2-7]{26}\.127\.0\.0\.1\.nip\.io$/);
    expect(resolvePreviewHostBaseDomain(env)).toBe('127.0.0.1.nip.io');
  });

  it('does not build host namespace from the default web URL fallback', () => {
    const env = {
      HANDY_MASTER_SECRET: 'preview-host-secret',
    };

    expect(resolvePreviewHostBaseDomain(env)).toBeNull();
    expect(buildHostNamespacePreviewHost(routeContext, env)).toBeNull();
  });

  it('suggests the public server host as the preview base domain', () => {
    expect(resolveSuggestedPreviewHostBaseDomain({
      HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
    })).toBe('app.example.com');
    expect(resolveSuggestedPreviewHostBaseDomain({
      HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.co.uk',
    })).toBe('app.example.co.uk');
    expect(resolveSuggestedPreviewHostBaseDomain({
      HAPPIER_PUBLIC_SERVER_URL: 'https://proxyapi.layaair.com',
    })).toBe('proxyapi.layaair.com');
  });

  it('does not suggest a preview base domain for local or IP server URLs', () => {
    expect(resolveSuggestedPreviewHostBaseDomain({
      HAPPIER_PUBLIC_SERVER_URL: 'http://localhost:3005',
    })).toBeNull();
    expect(resolveSuggestedPreviewHostBaseDomain({
      HAPPIER_PUBLIC_SERVER_URL: 'http://49.235.44.141:3005',
    })).toBeNull();
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
