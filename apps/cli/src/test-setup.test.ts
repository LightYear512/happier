import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function importSetupModule() {
    return await import('./test-setup');
}

describe('CLI test global setup', () => {
    const originalSkipBuild = process.env.HAPPIER_CLI_TEST_SKIP_BUILD;
    const tempDirs: string[] = [];

    afterEach(async () => {
        if (typeof originalSkipBuild === 'string') {
            process.env.HAPPIER_CLI_TEST_SKIP_BUILD = originalSkipBuild;
        } else {
            delete process.env.HAPPIER_CLI_TEST_SKIP_BUILD;
        }
        vi.restoreAllMocks();
        vi.resetModules();
        await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it('skips the dist build for shared-only mode', async () => {
        const { setup } = await importSetupModule();
        const ensureSharedDepsBuiltOnce = vi.fn(async () => undefined);
        const ensureDistBuiltOnce = vi.fn(async () => undefined);

        await setup({
            buildMode: 'shared-only',
            dependencies: {
                resolveProjectRoot: () => '/tmp/happier-cli-project',
                ensureSharedDepsBuiltOnce,
                ensureDistBuiltOnce,
            },
        });

        expect(ensureSharedDepsBuiltOnce).toHaveBeenCalledWith('/tmp/happier-cli-project');
        expect(ensureDistBuiltOnce).not.toHaveBeenCalled();
    });

    it('runs both shared deps and dist builds for full mode', async () => {
        const { setup } = await importSetupModule();
        const ensureSharedDepsBuiltOnce = vi.fn(async () => undefined);
        const ensureDistBuiltOnce = vi.fn(async () => undefined);

        await setup({
            buildMode: 'full',
            dependencies: {
                resolveProjectRoot: () => '/tmp/happier-cli-project',
                ensureSharedDepsBuiltOnce,
                ensureDistBuiltOnce,
            },
        });

        expect(ensureSharedDepsBuiltOnce).toHaveBeenCalledWith('/tmp/happier-cli-project');
        expect(ensureDistBuiltOnce).toHaveBeenCalledWith('/tmp/happier-cli-project');
    });

    it('respects the global skip-build override', async () => {
        const { setup } = await importSetupModule();
        process.env.HAPPIER_CLI_TEST_SKIP_BUILD = 'true';

        const ensureSharedDepsBuiltOnce = vi.fn(async () => undefined);
        const ensureDistBuiltOnce = vi.fn(async () => undefined);

        await setup({
            buildMode: 'full',
            dependencies: {
                resolveProjectRoot: () => '/tmp/happier-cli-project',
                ensureSharedDepsBuiltOnce,
                ensureDistBuiltOnce,
            },
        });

        expect(ensureSharedDepsBuiltOnce).not.toHaveBeenCalled();
        expect(ensureDistBuiltOnce).not.toHaveBeenCalled();
    });

    it('requires bundled protocol runtime dependency markers before skipping shared deps build', async () => {
        const ensureBuildArtifactsReadyOnce = vi.fn(async () => undefined);
        vi.doMock('./testSetupBuildCoordinator', () => ({
            ensureBuildArtifactsReadyOnce,
        }));

        const { setup } = await importSetupModule();

        await setup({
            buildMode: 'shared-only',
            dependencies: {
                resolveProjectRoot: () => cliProjectRoot,
            },
        });

        expect(ensureBuildArtifactsReadyOnce).toHaveBeenCalledTimes(1);
        expect(ensureBuildArtifactsReadyOnce).toHaveBeenCalledWith(
            expect.objectContaining({
                markerPaths: expect.arrayContaining([
                    join(cliProjectRoot, 'node_modules', '@happier-dev', 'protocol', 'dist', 'sessionFork.js'),
                    join(cliProjectRoot, 'node_modules', '@happier-dev', 'protocol', 'node_modules', 'zod', 'package.json'),
                    join(
                        cliProjectRoot,
                        'node_modules',
                        '@happier-dev',
                        'protocol',
                        'node_modules',
                        'base64-js',
                        'package.json',
                    ),
                ]),
            }),
        );
    });

    it('treats an older bundled protocol workspace as stale even when readiness markers exist', async () => {
        const tempRoot = await mkdtemp(join(tmpdir(), 'happier-cli-test-setup-stale-bundle-'));
        tempDirs.push(tempRoot);

        const tempCliProjectRoot = join(tempRoot, 'apps', 'cli');
        const sourceProtocolDir = join(tempRoot, 'packages', 'protocol');
        const sourceDistDir = join(sourceProtocolDir, 'dist');
        const bundledProtocolDir = join(tempCliProjectRoot, 'node_modules', '@happier-dev', 'protocol');
        const bundledDistDir = join(bundledProtocolDir, 'dist');
        const bundledNestedDistDir = join(bundledDistDir, 'features', 'payload');
        const bundledRuntimeDepsDir = join(bundledProtocolDir, 'node_modules');

        await mkdir(sourceDistDir, { recursive: true });
        await mkdir(bundledNestedDistDir, { recursive: true });
        await mkdir(join(bundledRuntimeDepsDir, 'zod'), { recursive: true });
        await mkdir(join(bundledRuntimeDepsDir, 'base64-js'), { recursive: true });

        const sourcePackageJsonPath = join(sourceProtocolDir, 'package.json');
        const sourceDistEntrypointPath = join(sourceDistDir, 'index.js');
        const bundledPackageJsonPath = join(bundledProtocolDir, 'package.json');
        const bundledDistEntrypointPath = join(bundledDistDir, 'index.js');
        const bundledSessionForkPath = join(bundledDistDir, 'sessionFork.js');
        const bundledIsRecordPath = join(bundledNestedDistDir, 'isRecord.js');

        await writeFile(
            sourcePackageJsonPath,
            `${JSON.stringify({ name: '@happier-dev/protocol', dependencies: { zod: '^3.0.0', 'base64-js': '^1.0.0' } })}\n`,
            'utf8',
        );
        await writeFile(sourceDistEntrypointPath, 'export const source = true;\n', 'utf8');
        await writeFile(bundledPackageJsonPath, `${JSON.stringify({ name: '@happier-dev/protocol' })}\n`, 'utf8');
        await writeFile(bundledDistEntrypointPath, 'export const bundled = true;\n', 'utf8');
        await writeFile(bundledSessionForkPath, 'export {};\n', 'utf8');
        await writeFile(bundledIsRecordPath, 'export {};\n', 'utf8');
        await writeFile(join(bundledRuntimeDepsDir, 'zod', 'package.json'), '{"name":"zod"}\n', 'utf8');
        await writeFile(join(bundledRuntimeDepsDir, 'base64-js', 'package.json'), '{"name":"base64-js"}\n', 'utf8');

        const staleAt = new Date(Date.now() - 60_000);
        const freshAt = new Date(Date.now() - 1_000);
        await utimes(bundledPackageJsonPath, staleAt, staleAt);
        await utimes(bundledDistEntrypointPath, staleAt, staleAt);
        await utimes(bundledSessionForkPath, staleAt, staleAt);
        await utimes(bundledIsRecordPath, staleAt, staleAt);
        await utimes(sourcePackageJsonPath, freshAt, freshAt);
        await utimes(sourceDistEntrypointPath, freshAt, freshAt);

        const { isBundledProtocolWorkspaceCurrent } = await importSetupModule();

        expect(isBundledProtocolWorkspaceCurrent(tempCliProjectRoot)).toBe(false);

        const syncedAt = new Date(Date.now() + 1_000);
        await utimes(bundledPackageJsonPath, syncedAt, syncedAt);
        await utimes(bundledDistEntrypointPath, syncedAt, syncedAt);
        await utimes(bundledSessionForkPath, syncedAt, syncedAt);
        await utimes(bundledIsRecordPath, syncedAt, syncedAt);

        expect(isBundledProtocolWorkspaceCurrent(tempCliProjectRoot)).toBe(true);
    });
});
