import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateNodeModulesIsolation } from './index.js';

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

async function createPackage(root: string, packageName: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeJson(join(root, 'package.json'), { name: packageName, version: '1.0.0' });
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'happier-node-modules-isolation-'));
}

describe('validateNodeModulesIsolation', () => {
  it('allows package symlinks that resolve inside the current repo', async () => {
    const root = tempRoot();
    await createHappierRepo(root);
    await createPackage(join(root, 'packages', 'protocol'), '@happier-dev/protocol');
    await mkdir(join(root, 'node_modules', '@happier-dev'), { recursive: true });
    await symlink(
      join(root, 'packages', 'protocol'),
      join(root, 'node_modules', '@happier-dev', 'protocol'),
      'dir',
    );

    const result = await validateNodeModulesIsolation({
      repoRoot: root,
      nodeModulesDirs: [join(root, 'node_modules')],
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.pollutedNodeModulesDirs).toEqual([]);
  });

  it('reports package symlinks resolving into another Happier checkout as hard errors', async () => {
    const currentRoot = join(tempRoot(), 'current');
    const otherRoot = join(tempRoot(), 'other');
    await createHappierRepo(currentRoot);
    await createHappierRepo(otherRoot);
    await createPackage(join(otherRoot, 'node_modules', 'zod'), 'zod');
    await mkdir(join(currentRoot, 'node_modules'), { recursive: true });
    await symlink(join(otherRoot, 'node_modules', 'zod'), join(currentRoot, 'node_modules', 'zod'), 'dir');

    const result = await validateNodeModulesIsolation({
      repoRoot: currentRoot,
      nodeModulesDirs: [join(currentRoot, 'node_modules')],
    });

    expect(result.ok).toBe(false);
    expect(result.pollutedNodeModulesDirs).toEqual([resolve(currentRoot, 'node_modules')]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'cross_happier_checkout_package_symlink',
        nodeModulesDir: resolve(currentRoot, 'node_modules'),
        symlinkPath: resolve(currentRoot, 'node_modules', 'zod'),
        resolvedTargetPath: await realpath(join(otherRoot, 'node_modules', 'zod')),
        repoRoot: resolve(currentRoot),
      }),
    ]);
  });

  it('scans scoped packages and reports workspace symlinks pointing at another checkout', async () => {
    const currentRoot = join(tempRoot(), 'current');
    const otherRoot = join(tempRoot(), 'other');
    await createHappierRepo(currentRoot);
    await createHappierRepo(otherRoot);
    await createPackage(join(otherRoot, 'packages', 'protocol'), '@happier-dev/protocol');
    await mkdir(join(currentRoot, 'node_modules', '@happier-dev'), { recursive: true });
    await symlink(
      join(otherRoot, 'packages', 'protocol'),
      join(currentRoot, 'node_modules', '@happier-dev', 'protocol'),
      'dir',
    );

    const result = await validateNodeModulesIsolation({
      repoRoot: currentRoot,
      nodeModulesDirs: [join(currentRoot, 'node_modules')],
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({
        code: 'cross_happier_checkout_workspace_symlink',
        symlinkPath: resolve(currentRoot, 'node_modules', '@happier-dev', 'protocol'),
      }),
    );
  });

  it('warns for missing symlink targets', async () => {
    const root = tempRoot();
    await createHappierRepo(root);
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await symlink(join(root, 'missing'), join(root, 'node_modules', 'missing-package'), 'dir');

    const result = await validateNodeModulesIsolation({
      repoRoot: root,
      nodeModulesDirs: [join(root, 'node_modules')],
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'missing_symlink_target',
        symlinkPath: resolve(root, 'node_modules', 'missing-package'),
      }),
    ]);
  });

  it('does not recurse into package internals during the default scan', async () => {
    const currentRoot = join(tempRoot(), 'current');
    const otherRoot = join(tempRoot(), 'other');
    await createHappierRepo(currentRoot);
    await createHappierRepo(otherRoot);
    await createPackage(join(currentRoot, 'node_modules', 'pkg'), 'pkg');
    await createPackage(join(otherRoot, 'node_modules', 'nested'), 'nested');
    await mkdir(join(currentRoot, 'node_modules', 'pkg', 'node_modules'), { recursive: true });
    await symlink(
      join(otherRoot, 'node_modules', 'nested'),
      join(currentRoot, 'node_modules', 'pkg', 'node_modules', 'nested'),
      'dir',
    );

    const result = await validateNodeModulesIsolation({
      repoRoot: currentRoot,
      nodeModulesDirs: [join(currentRoot, 'node_modules')],
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('allows explicitly configured external roots', async () => {
    const root = tempRoot();
    const externalRoot = tempRoot();
    await createHappierRepo(root);
    await createPackage(join(externalRoot, 'shared-package'), 'shared-package');
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await symlink(join(externalRoot, 'shared-package'), join(root, 'node_modules', 'shared-package'), 'dir');

    const result = await validateNodeModulesIsolation({
      repoRoot: root,
      nodeModulesDirs: [join(root, 'node_modules')],
      allowedExternalRoots: [externalRoot],
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('warns for external symlinks that are not Happier checkouts', async () => {
    const root = tempRoot();
    const externalRoot = tempRoot();
    await createHappierRepo(root);
    await createPackage(join(externalRoot, 'shared-package'), 'shared-package');
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await symlink(join(externalRoot, 'shared-package'), join(root, 'node_modules', 'shared-package'), 'dir');

    const result = await validateNodeModulesIsolation({
      repoRoot: root,
      nodeModulesDirs: [join(root, 'node_modules')],
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'external_package_symlink',
        symlinkPath: resolve(root, 'node_modules', 'shared-package'),
        resolvedTargetPath: await realpath(join(externalRoot, 'shared-package')),
      }),
    ]);
  });
});
