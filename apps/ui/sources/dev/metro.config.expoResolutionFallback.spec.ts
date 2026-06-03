import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('apps/ui/metro.config.js (Expo resolution fallbacks)', () => {
    const envSnapshot = { ...process.env };

    function requireFreshMetroConfig() {
        // Metro expects a CommonJS config, so this file uses `require`. Vitest does not reliably clear
        // the CommonJS require cache via `vi.resetModules()`, so clear it manually to allow per-test env.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const resolved = require.resolve('../../metro.config.js');
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete require.cache[resolved];
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('../../metro.config.js');
    }

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...envSnapshot };
    });

    afterEach(() => {
        vi.resetModules();
        process.env = { ...envSnapshot };
    });

    it('stubs `expo-system-ui` on web', () => {
        const config = requireFreshMetroConfig();

        const expectedStubPath = path.resolve(__dirname, '../platform/stubs/expoSystemUiWebStub.ts');
        const result = config.resolver.resolveRequest(
            { resolveRequest: () => ({ type: 'empty' }) },
            'expo-system-ui',
            'web',
        );

        expect(result).toEqual({ type: 'sourceFile', filePath: expectedStubPath });
        expect(fs.existsSync(expectedStubPath)).toBe(true);
    });

    it('stubs `mermaid` on native platforms', () => {
        const config = requireFreshMetroConfig();
        const expectedStubPath = path.resolve(__dirname, '../platform/stubs/mermaidNativeStub.ts');

        expect(config.resolver.resolveRequest({}, 'mermaid', 'android')).toEqual({
            type: 'sourceFile',
            filePath: expectedStubPath,
        });
        expect(config.resolver.resolveRequest({}, 'mermaid', 'ios')).toEqual({
            type: 'sourceFile',
            filePath: expectedStubPath,
        });
        expect(fs.existsSync(expectedStubPath)).toBe(true);
    });

    it('resolves workspace app entry requests back to this checkout on native platforms', () => {
        const config = requireFreshMetroConfig();
        const expectedEntryPath = path.resolve(__dirname, '../../index.ts');

        expect(config.resolver.resolveRequest({}, './apps/ui/index.ts', 'android')).toEqual({
            type: 'sourceFile',
            filePath: expectedEntryPath,
        });
        expect(config.resolver.resolveRequest({}, 'apps/ui/index.ts', 'ios')).toEqual({
            type: 'sourceFile',
            filePath: expectedEntryPath,
        });
        expect(fs.existsSync(expectedEntryPath)).toBe(true);
    });

    it('falls back to resolving hoisted Expo modules through Node-resolved package paths', () => {
        const config = requireFreshMetroConfig();
        const expectedResolvedPath = require.resolve('expo-modules-core', {
            paths: [config.projectRoot],
        });

        const result = config.resolver.resolveRequest(
            // Provide a minimal context; the default resolver can throw in this unit-test harness,
            // and the config should fall back to Node resolution rooted at the monorepo `node_modules`.
            {},
            'expo-modules-core',
            'web',
        );

        expect(result).toEqual({
            type: 'sourceFile',
            filePath: expectedResolvedPath,
        });
        expect(fs.existsSync(String(result?.filePath))).toBe(true);
    });

    it('falls back to resolving transitive dependency paths through Node resolution', () => {
        const config = requireFreshMetroConfig();
        const expectedResolvedPath = require.resolve('fbjs/lib/invariant', {
            paths: [config.projectRoot],
        });

        const result = config.resolver.resolveRequest(
            {},
            'fbjs/lib/invariant',
            'web',
        );

        expect(result).toEqual({
            type: 'sourceFile',
            filePath: expectedResolvedPath,
        });
        expect(fs.existsSync(String(result?.filePath))).toBe(true);
    });

    it('rewrites @noble/hashes/crypto.js to an exported subpath', () => {
        const config = requireFreshMetroConfig();

        expect(() => config.resolver.resolveRequest({}, '@noble/hashes/crypto.js', 'web')).not.toThrow();

        const result = config.resolver.resolveRequest({}, '@noble/hashes/crypto.js', 'web');
        expect(result?.type).toBe('sourceFile');
        expect(typeof result?.filePath).toBe('string');
        expect(fs.existsSync(String(result?.filePath))).toBe(true);
    });

    it('rewrites absolute @noble/hashes/crypto.js file requests before Metro package export validation', () => {
        const config = requireFreshMetroConfig();
        const cryptoJsPath = path.resolve(__dirname, '../../../../node_modules/@noble/hashes/crypto.js');

        expect(() => config.resolver.resolveRequest({}, cryptoJsPath, 'web')).not.toThrow();

        const result = config.resolver.resolveRequest({}, cryptoJsPath, 'web');
        expect(result?.type).toBe('sourceFile');
        expect(typeof result?.filePath).toBe('string');
        expect(fs.existsSync(String(result?.filePath))).toBe(true);
    });

    it('stubs Node os imports before Metro tries to hash builtin module ids', () => {
        const config = requireFreshMetroConfig();
        const expectedShimPath = path.resolve(__dirname, '../platform/nodeShims/nodeOsShim.ts');

        expect(config.resolver.resolveRequest({}, 'node:os', 'ios')).toEqual({
            type: 'sourceFile',
            filePath: expectedShimPath,
        });
        expect(config.resolver.resolveRequest({}, 'os', 'ios')).toEqual({
            type: 'sourceFile',
            filePath: expectedShimPath,
        });
        expect(fs.existsSync(expectedShimPath)).toBe(true);
    });

    it('disables Watchman in stack builds (HAPPIER_STACK_STACK set)', () => {
        process.env.HAPPIER_STACK_STACK = 'qa-test';
        delete process.env.CI;

        const config = requireFreshMetroConfig();
        expect(config?.resolver?.useWatchman).toBe(false);
    });
});
