import { describe, expect, it } from 'vitest';

import { resolveHostPreviewBaseDomain } from './hostPreviewBaseDomainResolution';

describe('resolveHostPreviewBaseDomain', () => {
    it('uses explicit same-site base domain', () => {
        expect(resolveHostPreviewBaseDomain({
            HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
            HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.example.com',
            HANDY_MASTER_SECRET: 'secret',
        })).toMatchObject({
            enabled: true,
            baseDomain: 'preview.example.com',
            source: 'explicit',
            webSite: 'example.com',
            previewSite: 'example.com',
        });
    });

    it('rejects explicit cross-site base domain', () => {
        expect(resolveHostPreviewBaseDomain({
            HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
            HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.other.test',
            HANDY_MASTER_SECRET: 'secret',
        })).toMatchObject({
            enabled: false,
            source: 'explicit',
            reason: 'cross_site_preview_base_domain',
            fatal: true,
        });
    });

    it('derives from explicit web URL when host is wildcardable', () => {
        expect(resolveHostPreviewBaseDomain({
            HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1.nip.io:3005',
            HANDY_MASTER_SECRET: 'secret',
        })).toMatchObject({
            enabled: true,
            baseDomain: '127.0.0.1.nip.io',
            source: 'derived',
            effectiveWebUrlSource: 'explicit',
        });
    });

    it('uses the explicit webapp URL as the same-site anchor when public server URL differs', () => {
        expect(resolveHostPreviewBaseDomain({
            HAPPIER_PUBLIC_SERVER_URL: 'https://api.other.test',
            HAPPIER_WEBAPP_URL: 'https://app.example.com',
            HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.example.com',
            HANDY_MASTER_SECRET: 'secret',
        })).toMatchObject({
            enabled: true,
            baseDomain: 'preview.example.com',
            effectiveWebUrl: 'https://app.example.com',
            effectiveWebUrlSource: 'explicit',
            webSite: 'example.com',
            previewSite: 'example.com',
        });
    });

    it('preserves default web URL diagnostics when explicit preview domain is validated against the default', () => {
        expect(resolveHostPreviewBaseDomain({
            HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.layaair.com',
            HANDY_MASTER_SECRET: 'secret',
        })).toMatchObject({
            enabled: true,
            baseDomain: 'preview.layaair.com',
            source: 'explicit',
            effectiveWebUrl: 'https://proxyapi.layaair.com',
            effectiveWebUrlSource: 'default',
            webSite: 'layaair.com',
            previewSite: 'layaair.com',
        });
    });

    it('reports derived local UI source when webapp URL is inferred from a served UI prefix', () => {
        expect(resolveHostPreviewBaseDomain({
            HAPPIER_PUBLIC_SERVER_URL: 'https://stack.example.com/base',
            HAPPIER_SERVER_UI_DIR: '/tmp/ui',
            HAPPIER_SERVER_UI_PREFIX: '/ui',
            HANDY_MASTER_SECRET: 'secret',
        })).toMatchObject({
            enabled: true,
            baseDomain: 'stack.example.com',
            source: 'derived',
            effectiveWebUrl: 'https://stack.example.com/base/ui',
            effectiveWebUrlSource: 'derived_local_ui',
        });
    });

    it('does not derive from default web URL fallback', () => {
        expect(resolveHostPreviewBaseDomain({
            HANDY_MASTER_SECRET: 'secret',
        })).toMatchObject({
            enabled: false,
            source: 'derived',
            reason: 'default_web_url_not_derivable',
            fatal: true,
        });
    });

    it('allows development path-only when derivation is unavailable', () => {
        expect(resolveHostPreviewBaseDomain({
            NODE_ENV: 'development',
            HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1:3005',
            HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
            HANDY_MASTER_SECRET: 'secret',
        })).toMatchObject({
            enabled: false,
            reason: 'path_mode_only',
            fatal: false,
        });
    });

    it.each([
        ['relay disabled', {
            HAPPIER_FEATURE_SESSIONS_DEV_PREVIEW_RELAY__ENABLED: '0',
            HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.other.test',
        }, { enabled: false, reason: 'relay_disabled', fatal: false }],
        ['valid explicit', {
            HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
            HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.example.com',
        }, { enabled: true, source: 'explicit' }],
        ['invalid explicit', {
            HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
            HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'bad domain',
        }, { enabled: false, reason: 'invalid_preview_base_domain', fatal: true }],
        ['valid derived', {
            HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
        }, { enabled: true, source: 'derived', baseDomain: 'app.example.com' }],
        ['default fallback with dev path', {
            NODE_ENV: 'development',
            HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
        }, { enabled: false, reason: 'default_web_url_not_derivable', fatal: false }],
        ['default fallback without path', {
            NODE_ENV: 'production',
        }, { enabled: false, reason: 'default_web_url_not_derivable', fatal: true }],
    ])('%s', (_name, env, expected) => {
        expect(resolveHostPreviewBaseDomain({
            HANDY_MASTER_SECRET: 'secret',
            ...env,
        })).toMatchObject(expected);
    });
});
