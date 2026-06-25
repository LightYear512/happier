import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createStartServerDbMocks,
    installStartServerDbModuleMock,
    installStartServerCommonWiringMocks,
} from '@/testkit/startServerMocks';
import { createStartServerHarness } from '@/testkit/startServerHarness';

const startServerDbMocks = createStartServerDbMocks({
    getDbProviderFromEnv: (_env: unknown, fallback: unknown) => fallback,
});

installStartServerDbModuleMock(startServerDbMocks);
installStartServerCommonWiringMocks();

vi.mock('@/utils/process/shutdown', async () => {
    const actual = await vi.importActual<any>('@/utils/process/shutdown');
    return { ...actual, awaitShutdown: vi.fn(async () => {}) };
});

describe('startServer host preview startup validation', () => {
    const startServerHarness = createStartServerHarness({
        HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: undefined,
        HAPPIER_PUBLIC_SERVER_URL: undefined,
        HAPPIER_WEBAPP_URL: undefined,
        HAPPY_WEBAPP_URL: undefined,
        HAPPIER_FEATURE_SESSIONS_DEV_PREVIEW_RELAY__ENABLED: undefined,
        HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: undefined,
        NODE_ENV: undefined,
    });

    beforeEach(() => {
        startServerDbMocks.reset();
        startServerHarness.reset();
    });

    it('fails before opening the database when host preview is explicitly cross-site', async () => {
        await expect(startServerHarness.start('full', {
            SERVER_ROLE: 'api',
            HAPPIER_DB_PROVIDER: 'mysql',
            HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
            HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.other.test',
        })).rejects.toThrow(/cross_site_preview_base_domain/);

        expect(startServerDbMocks.dbConnect).not.toHaveBeenCalled();
    });
});
