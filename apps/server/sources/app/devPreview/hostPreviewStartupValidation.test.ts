import { describe, expect, it } from 'vitest';

import { validateHostPreviewStartupConfig } from './hostPreviewStartupValidation';

describe('validateHostPreviewStartupConfig', () => {
    it('throws for explicit cross-site host preview configuration', () => {
        expect(() => validateHostPreviewStartupConfig({
            HANDY_MASTER_SECRET: 'secret',
            HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
            HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.other.test',
        })).toThrow(/cross_site_preview_base_domain/);
    });

    it('throws in production when host preview cannot derive from the default web URL', () => {
        expect(() => validateHostPreviewStartupConfig({
            NODE_ENV: 'production',
            HANDY_MASTER_SECRET: 'secret',
        })).toThrow(/default_web_url_not_derivable/);
    });

    it('does not throw for development path-only mode', () => {
        expect(() => validateHostPreviewStartupConfig({
            NODE_ENV: 'development',
            HANDY_MASTER_SECRET: 'secret',
            HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1:3005',
            HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
        })).not.toThrow();
    });
});
