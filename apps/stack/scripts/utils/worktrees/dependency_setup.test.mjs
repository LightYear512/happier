import test from 'node:test';
import assert from 'node:assert/strict';

import { setupInstalledWorktreeDependencies } from './dependency_setup.mjs';

function okIsolation() {
  return { ok: true, errors: [], warnings: [], pollutedNodeModulesDirs: [] };
}

function pollutedIsolation(dir = '/repo/node_modules') {
  return {
    ok: false,
    errors: [
      {
        code: 'cross_happier_checkout_package_symlink',
        symlinkPath: `${dir}/zod`,
        resolvedTargetPath: '/other/node_modules/zod',
        repoRoot: '/repo',
        nodeModulesDir: dir,
      },
    ],
    warnings: [],
    pollutedNodeModulesDirs: [dir],
  };
}

test('setupInstalledWorktreeDependencies skips seeding from a polluted base checkout', async () => {
  const validateCalls = [];
  const installCalls = [];
  let seedCalled = false;

  const res = await setupInstalledWorktreeDependencies({
    baseDir: '/base',
    worktreeDir: '/worktree',
    validateDependencyIsolation: async (params) => {
      validateCalls.push(params.repoRoot);
      return validateCalls.length === 1 ? pollutedIsolation('/base/node_modules') : okIsolation();
    },
    seedNodeModulesFromBase: async () => {
      seedCalled = true;
      return { ok: true, seeded: true, reason: 'seeded' };
    },
    installDependencies: async (params) => {
      installCalls.push(params);
      return { installed: true, reason: null };
    },
  });

  assert.equal(seedCalled, false);
  assert.deepEqual(validateCalls, ['/base', '/worktree', '/worktree']);
  assert.deepEqual(installCalls, [{ dir: '/worktree', force: false }]);
  assert.deepEqual(res, { installed: true, message: 'base-dependency-tree-polluted; installed clean deps' });
});

test('setupInstalledWorktreeDependencies deletes only validator-reported dirs after polluted seeding', async () => {
  const removed = [];
  const installCalls = [];
  const validations = [okIsolation(), pollutedIsolation('/worktree/apps/ui/node_modules'), okIsolation(), okIsolation()];

  await setupInstalledWorktreeDependencies({
    baseDir: '/base',
    worktreeDir: '/worktree',
    validateDependencyIsolation: async () => validations.shift() ?? okIsolation(),
    seedNodeModulesFromBase: async () => ({ ok: true, seeded: true, reason: 'seeded' }),
    removePollutedDirs: async (result) => {
      removed.push(...result.pollutedNodeModulesDirs);
      return result.pollutedNodeModulesDirs;
    },
    installDependencies: async (params) => {
      installCalls.push(params);
      return { installed: true, reason: null };
    },
  });

  assert.deepEqual(removed, ['/worktree/apps/ui/node_modules']);
  assert.deepEqual(installCalls, [{ dir: '/worktree', force: true }]);
});

test('setupInstalledWorktreeDependencies fails fast when post-install pollution remains', async () => {
  const validations = [okIsolation(), okIsolation(), pollutedIsolation('/worktree/node_modules')];

  await assert.rejects(
    setupInstalledWorktreeDependencies({
      baseDir: '/base',
      worktreeDir: '/worktree',
      validateDependencyIsolation: async () => validations.shift() ?? okIsolation(),
      seedNodeModulesFromBase: async () => ({ ok: true, seeded: false, reason: 'disabled' }),
      installDependencies: async () => ({ installed: true, reason: null }),
    }),
    /dependency isolation check failed after install/,
  );
});
