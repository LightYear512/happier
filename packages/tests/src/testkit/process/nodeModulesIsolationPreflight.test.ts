import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertE2eNodeModulesIsolation,
  formatNodeModulesIsolationPreflightError,
  resolveE2eNodeModulesIsolationDirs,
} from './nodeModulesIsolationPreflight';

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createHappierRepo(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeJson(join(root, 'package.json'), {
    name: 'monorepo',
    private: true,
    workspaces: { packages: ['apps/*', 'packages/*'] },
  });
  await writeFile(join(root, 'yarn.lock'), '', 'utf8');
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'happier-e2e-nm-preflight-'));
}

describe('nodeModulesIsolationPreflight', () => {
  it('resolves UI and CLI preflight scan scopes', () => {
    expect(resolveE2eNodeModulesIsolationDirs({ rootDir: '/repo', scope: 'ui' })).toEqual([
      resolve('/repo/node_modules'),
      resolve('/repo/apps/ui/node_modules'),
    ]);
    expect(resolveE2eNodeModulesIsolationDirs({ rootDir: '/repo', scope: 'cli' })).toEqual([
      resolve('/repo/node_modules'),
      resolve('/repo/apps/cli/node_modules'),
      resolve('/repo/apps/server/node_modules'),
    ]);
  });

  it('formats actionable cleanup diagnostics without mutating dependencies', () => {
    const message = formatNodeModulesIsolationPreflightError({
      ok: false,
      pollutedNodeModulesDirs: ['/repo/node_modules'],
      warnings: [],
      errors: [
        {
          code: 'cross_happier_checkout_package_symlink',
          repoRoot: '/repo',
          nodeModulesDir: '/repo/node_modules',
          symlinkPath: '/repo/node_modules/zod',
          resolvedTargetPath: '/other/node_modules/zod',
        },
      ],
    });

    expect(message).toContain('/repo/node_modules/zod');
    expect(message).toContain('/other/node_modules/zod');
    expect(message).toContain('node -e');
    expect(message).toContain('yarn install --frozen-lockfile');
  });

  it('fails fast for polluted UI dependency trees before callers start Metro', async () => {
    const root = join(tempRoot(), 'current');
    const other = join(tempRoot(), 'other');
    await createHappierRepo(root);
    await createHappierRepo(other);
    await mkdir(join(other, 'node_modules', 'expo-router'), { recursive: true });
    await writeJson(join(other, 'node_modules', 'expo-router', 'package.json'), { name: 'expo-router' });
    await mkdir(join(root, 'apps', 'ui', 'node_modules'), { recursive: true });
    await symlink(
      join(other, 'node_modules', 'expo-router'),
      join(root, 'apps', 'ui', 'node_modules', 'expo-router'),
      'dir',
    );

    await expect(assertE2eNodeModulesIsolation({ rootDir: root, scope: 'ui' })).rejects.toThrow(
      /node_modules dependency isolation preflight failed/,
    );
  });
});
