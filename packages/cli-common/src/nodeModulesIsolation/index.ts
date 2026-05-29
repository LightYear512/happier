import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type NodeModulesIsolationFindingCode =
  | 'cross_happier_checkout_package_symlink'
  | 'cross_happier_checkout_workspace_symlink'
  | 'external_package_symlink'
  | 'missing_symlink_target';

export type NodeModulesIsolationFinding = Readonly<{
  code: NodeModulesIsolationFindingCode;
  symlinkPath: string;
  resolvedTargetPath: string | null;
  repoRoot: string;
  nodeModulesDir: string;
}>;

export type NodeModulesIsolationResult = Readonly<{
  ok: boolean;
  errors: NodeModulesIsolationFinding[];
  warnings: NodeModulesIsolationFinding[];
  pollutedNodeModulesDirs: string[];
}>;

export type ValidateNodeModulesIsolationOptions = Readonly<{
  repoRoot: string;
  nodeModulesDirs: readonly string[];
  allowedExternalRoots?: readonly string[];
  includeBin?: boolean;
}>;

type HappierMonorepoRoot = Readonly<{
  root: string;
}>;

function normalizePath(path: string): string {
  return resolve(path);
}

function isSameOrInsidePath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isWorkspacePackageName(packageName: string): boolean {
  return packageName.startsWith('@happier-dev/');
}

function packageNameFromSymlinkPath(nodeModulesDir: string, symlinkPath: string): string {
  const rel = relative(nodeModulesDir, symlinkPath).split(/[\\/]/).filter(Boolean);
  if (rel[0]?.startsWith('@')) return rel.slice(0, 2).join('/');
  return rel[0] ?? '';
}

async function readPackageJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function realpathOrResolved(path: string): Promise<string> {
  return realpath(path).catch(() => normalizePath(path));
}

function hasHappierWorkspaceMarker(packageJson: Record<string, unknown>): boolean {
  if (packageJson.name === 'monorepo') return true;

  const workspaces = packageJson.workspaces;
  const packages = Array.isArray(workspaces)
    ? workspaces
    : workspaces && typeof workspaces === 'object' && !Array.isArray(workspaces)
      ? (workspaces as Record<string, unknown>).packages
      : null;

  if (!Array.isArray(packages)) return false;
  return packages.some((entry) => typeof entry === 'string' && (entry === 'apps/*' || entry === 'packages/*'));
}

async function findHappierMonorepoRoot(startPath: string): Promise<HappierMonorepoRoot | null> {
  let cursor = startPath;
  while (true) {
    const packageJson = await readPackageJson(resolve(cursor, 'package.json'));
    if (packageJson && hasHappierWorkspaceMarker(packageJson)) return { root: cursor };

    const next = dirname(cursor);
    if (next === cursor) return null;
    cursor = next;
  }
}

async function collectPackageEntrySymlinks(nodeModulesDir: string, includeBin: boolean): Promise<string[]> {
  const symlinks: string[] = [];
  let entries;
  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true });
  } catch {
    return symlinks;
  }

  for (const entry of entries) {
    if (entry.name === '.bin') {
      if (!includeBin) continue;
      const binDir = resolve(nodeModulesDir, entry.name);
      let binEntries;
      try {
        binEntries = await readdir(binDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const binEntry of binEntries) {
        const binPath = resolve(binDir, binEntry.name);
        const stats = await lstat(binPath).catch(() => null);
        if (stats?.isSymbolicLink()) symlinks.push(binPath);
      }
      continue;
    }

    if (entry.name.startsWith('@') && entry.isDirectory()) {
      const scopeDir = resolve(nodeModulesDir, entry.name);
      let scopedEntries;
      try {
        scopedEntries = await readdir(scopeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const scopedEntry of scopedEntries) {
        const packagePath = resolve(scopeDir, scopedEntry.name);
        const stats = await lstat(packagePath).catch(() => null);
        if (stats?.isSymbolicLink()) symlinks.push(packagePath);
      }
      continue;
    }

    const packagePath = resolve(nodeModulesDir, entry.name);
    const stats = await lstat(packagePath).catch(() => null);
    if (stats?.isSymbolicLink()) symlinks.push(packagePath);
  }

  return symlinks.sort((left, right) => left.localeCompare(right));
}

export async function validateNodeModulesIsolation(
  options: ValidateNodeModulesIsolationOptions,
): Promise<NodeModulesIsolationResult> {
  const repoRoot = normalizePath(options.repoRoot);
  const repoRootRealPath = await realpathOrResolved(repoRoot);
  const allowedExternalRoots = await Promise.all((options.allowedExternalRoots ?? []).map(realpathOrResolved));
  const nodeModulesDirs = options.nodeModulesDirs.map(normalizePath);
  const currentRepoRoot = await findHappierMonorepoRoot(repoRootRealPath);
  const errors: NodeModulesIsolationFinding[] = [];
  const warnings: NodeModulesIsolationFinding[] = [];

  for (const nodeModulesDir of nodeModulesDirs) {
    const symlinks = await collectPackageEntrySymlinks(nodeModulesDir, options.includeBin === true);
    for (const symlinkPath of symlinks) {
      const resolvedTargetPath = await realpath(symlinkPath).catch(() => null);
      if (!resolvedTargetPath) {
        warnings.push({
          code: 'missing_symlink_target',
          symlinkPath,
          resolvedTargetPath: null,
          repoRoot,
          nodeModulesDir,
        });
        continue;
      }

      if (isSameOrInsidePath(repoRootRealPath, resolvedTargetPath)) continue;
      if (allowedExternalRoots.some((allowedRoot) => isSameOrInsidePath(allowedRoot, resolvedTargetPath))) continue;

      const targetRepoRoot = await findHappierMonorepoRoot(resolvedTargetPath);
      if (targetRepoRoot && targetRepoRoot.root !== currentRepoRoot?.root) {
        const packageName = packageNameFromSymlinkPath(nodeModulesDir, symlinkPath);
        errors.push({
          code: isWorkspacePackageName(packageName)
            ? 'cross_happier_checkout_workspace_symlink'
            : 'cross_happier_checkout_package_symlink',
          symlinkPath,
          resolvedTargetPath,
          repoRoot,
          nodeModulesDir,
        });
        continue;
      }

      warnings.push({
        code: 'external_package_symlink',
        symlinkPath,
        resolvedTargetPath,
        repoRoot,
        nodeModulesDir,
      });
    }
  }

  const pollutedNodeModulesDirs = [...new Set(errors.map((finding) => finding.nodeModulesDir))]
    .sort((left, right) => left.localeCompare(right));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    pollutedNodeModulesDirs,
  };
}
