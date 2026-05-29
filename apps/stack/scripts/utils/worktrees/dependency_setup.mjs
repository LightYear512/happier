import {
  formatDependencyIsolationFindings,
  removePollutedNodeModulesDirs,
  validateWorktreeDependencyIsolation,
} from './node_modules_isolation.mjs';
import { seedNodeModulesFromBase as defaultSeedNodeModulesFromBase } from './seed_node_modules.mjs';

export async function setupInstalledWorktreeDependencies({
  baseDir,
  worktreeDir,
  seedNodeModulesFromBase = defaultSeedNodeModulesFromBase,
  installDependencies,
  validateDependencyIsolation = validateWorktreeDependencyIsolation,
  removePollutedDirs = removePollutedNodeModulesDirs,
} = {}) {
  if (typeof installDependencies !== 'function') {
    throw new Error('[wt] installDependencies callback is required');
  }

  const baseIsolation = await validateDependencyIsolation({ repoRoot: baseDir });
  const seed = baseIsolation.ok
    ? await seedNodeModulesFromBase({ baseDir, worktreeDir })
    : { ok: true, seeded: false, reason: 'base-dependency-tree-polluted' };

  let forceInstall = false;

  if (seed.seeded) {
    const seededIsolation = await validateDependencyIsolation({ repoRoot: worktreeDir });
    if (!seededIsolation.ok) {
      await removePollutedDirs(seededIsolation);
      forceInstall = true;
    }
  }

  const targetIsolation = await validateDependencyIsolation({ repoRoot: worktreeDir });
  if (!targetIsolation.ok) {
    await removePollutedDirs(targetIsolation);
    forceInstall = true;
  }

  const inst = await installDependencies({ dir: worktreeDir, force: forceInstall });

  const installedIsolation = await validateDependencyIsolation({ repoRoot: worktreeDir });
  if (!installedIsolation.ok) {
    throw new Error(
      [
        '[wt] dependency isolation check failed after install.',
        formatDependencyIsolationFindings(installedIsolation),
      ].filter(Boolean).join('\n'),
    );
  }

  return {
    installed: Boolean(inst.installed),
    message: inst.reason ?? (!baseIsolation.ok ? 'base-dependency-tree-polluted; installed clean deps' : null),
  };
}
