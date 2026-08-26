import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { HappyError } from '@/utils/errors/errors';

const serverFetchSpy = vi.hoisted(() => vi.fn());

vi.mock('@/sync/http/client', () => ({
    serverFetch: (...args: unknown[]) => serverFetchSpy(...args),
}));

vi.mock('@/utils/timing/time', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/timing/time')>();
    const immediate = async <T,>(callback: () => Promise<T>): Promise<T> => await callback();
    return {
        ...actual,
        backoff: immediate,
        backoffForever: immediate,
    };
});

afterEach(() => {
    serverFetchSpy.mockReset();
    vi.unstubAllGlobals();
    vi.resetModules();
});

const credentials: AuthCredentials = { token: 't', secret: 's' };

describe('setAccountUsername', () => {
    it('returns the username on success', async () => {
        serverFetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ username: 'alice' }) });

        const { setAccountUsername } = await import('./apiUsername');
        const res = await setAccountUsername(credentials, 'alice');

        expect(serverFetchSpy).toHaveBeenCalledWith(
            '/v1/account/username',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer t',
                    'Content-Type': 'application/json',
                }),
            }),
            { includeAuth: false },
        );
        expect(res).toEqual({ username: 'alice' });
    });

    it('throws HappyError(username-taken) on 409 username-taken', async () => {
        serverFetchSpy.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'username-taken' }) });

        const { setAccountUsername } = await import('./apiUsername');
        await expect(setAccountUsername(credentials, 'alice')).rejects.toMatchObject({
            name: 'HappyError',
            message: 'username-taken',
            status: 409,
        } satisfies Partial<HappyError>);
    });

    it('throws HappyError(invalid-username) on 400 invalid-username', async () => {
        serverFetchSpy.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid-username' }) });

        const { setAccountUsername } = await import('./apiUsername');
        await expect(setAccountUsername(credentials, 'bad')).rejects.toMatchObject({
            name: 'HappyError',
            message: 'invalid-username',
            status: 400,
        } satisfies Partial<HappyError>);
    });

    it('maps username-disabled to config-kind HappyError', async () => {
        serverFetchSpy.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'username-disabled' }) });

        const { setAccountUsername } = await import('./apiUsername');
        await expect(setAccountUsername(credentials, 'alice')).rejects.toMatchObject({
            name: 'HappyError',
            message: 'username-disabled',
            kind: 'config',
            status: 400,
        } satisfies Partial<HappyError>);
    });

    it('falls back to default 4xx message when error body is not JSON', async () => {
        serverFetchSpy.mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => {
                throw new Error('invalid json');
            },
        });

        const { setAccountUsername } = await import('./apiUsername');
        await expect(setAccountUsername(credentials, 'alice')).rejects.toMatchObject({
            name: 'HappyError',
            message: 'Failed to set username',
            kind: 'server',
            status: 400,
        } satisfies Partial<HappyError>);
    });

    it('throws parse error when success payload does not include username', async () => {
        serverFetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });

        const { setAccountUsername } = await import('./apiUsername');
        await expect(setAccountUsername(credentials, 'alice')).rejects.toThrow('Failed to parse set username response');
    });
});
