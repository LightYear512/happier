import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

function requireFreshMetroConfig() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const resolved = require.resolve('../../metro.config.js');
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[resolved];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../metro.config.js');
}

describe('metro.config.js (kokoro)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@sentry/react-native/metro', () => ({
      getSentryExpoConfig: (projectRoot: string) => ({
        projectRoot,
        watchFolders: [],
        resolver: {
          assetExts: [],
          resolveRequest: (_context: unknown, moduleName: string) => ({
            type: 'sourceFile',
            filePath: moduleName,
          }),
        },
        serializer: {},
        transformer: {},
      }),
    }));
  });

  afterEach(() => {
    vi.doUnmock('@sentry/react-native/metro');
    vi.resetModules();
  });

  it('overrides kokoro-js for web bundling', () => {
    const config = requireFreshMetroConfig();

    expect(config?.resolver?.resolveRequest).toEqual(expect.any(Function));

    const res = config.resolver.resolveRequest(
      {
        resolveRequest: () => ({ type: 'empty' }),
      },
      'kokoro-js',
      'web',
    );

    expect(res?.type).toBe('sourceFile');
    expect(String(res?.filePath)).toBe(resolve(process.cwd(), 'sources/platform/stubs/kokoroJsStub.ts'));

    const resDeep = config.resolver.resolveRequest(
      {
        resolveRequest: () => ({ type: 'empty' }),
      },
      'kokoro-js/dist/kokoro.web.js',
      'web',
    );
    expect(resDeep?.type).toBe('sourceFile');
    expect(String(resDeep?.filePath)).toBe(resolve(process.cwd(), 'sources/platform/stubs/kokoroJsStub.ts'));
  });

  it('shims Node builtins used by kokoro/transformers for native bundling', () => {
    const config = requireFreshMetroConfig();

    const resPath = config.resolver.resolveRequest(
      { resolveRequest: () => ({ type: 'empty' }) },
      'node:path',
      'ios',
    );
    expect(resPath?.type).toBe('sourceFile');
    expect(String(resPath?.filePath)).toBe(resolve(process.cwd(), 'sources/platform/nodeShims/nodePathShim.ts'));

    const resFs = config.resolver.resolveRequest(
      { resolveRequest: () => ({ type: 'empty' }) },
      'node:fs',
      'android',
    );
    expect(resFs?.type).toBe('sourceFile');
    expect(String(resFs?.filePath)).toBe(resolve(process.cwd(), 'sources/platform/nodeShims/nodeFsShim.ts'));

    const resFsPromises = config.resolver.resolveRequest(
      { resolveRequest: () => ({ type: 'empty' }) },
      'node:fs/promises',
      'ios',
    );
    expect(resFsPromises?.type).toBe('sourceFile');
    expect(String(resFsPromises?.filePath)).toBe(
      resolve(process.cwd(), 'sources/platform/nodeShims/nodeFsPromisesShim.ts'),
    );
  });

  it('normalizes the monorepo web entry request back to the UI workspace entry file', () => {
    const config = requireFreshMetroConfig();

    const res = config.resolver.resolveRequest(
      {
        originModulePath: resolve(process.cwd(), '..'),
        resolveRequest: () => ({ type: 'empty' }),
      },
      './apps/ui/index.ts',
      'web',
    );

    expect(res?.type).toBe('sourceFile');
    expect(String(res?.filePath)).toBe(resolve(process.cwd(), 'index.ts'));
  });

  it('does not inject the monorepo root into watchFolders when the workspace entry file already lives under projectRoot', () => {
    const config = requireFreshMetroConfig();
    const repoRoot = resolve(process.cwd(), '../..');

    expect(config.projectRoot).toBe(resolve(process.cwd()));
    expect(config.watchFolders).not.toContain(repoRoot);
  });
});
