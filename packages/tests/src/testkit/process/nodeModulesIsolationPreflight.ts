import { validateNodeModulesIsolation, type NodeModulesIsolationResult } from '@happier-dev/cli-common/nodeModulesIsolation';
import { resolve } from 'node:path';
import { repoRootDir } from '../paths';

export type E2eNodeModulesIsolationScope = 'ui' | 'cli';

export function resolveE2eNodeModulesIsolationDirs(params: {
  rootDir?: string;
  scope: E2eNodeModulesIsolationScope;
}): string[] {
  const rootDir = params.rootDir ?? repoRootDir();
  if (params.scope === 'ui') {
    return [
      resolve(rootDir, 'node_modules'),
      resolve(rootDir, 'apps', 'ui', 'node_modules'),
    ];
  }
  return [
    resolve(rootDir, 'node_modules'),
    resolve(rootDir, 'apps', 'cli', 'node_modules'),
    resolve(rootDir, 'apps', 'server', 'node_modules'),
  ];
}

export function formatNodeModulesIsolationPreflightError(result: NodeModulesIsolationResult): string {
  const pollutedDirs = result.pollutedNodeModulesDirs;
  const cleanupScript = [
    "const fs=require('node:fs');",
    `for (const dir of ${JSON.stringify(pollutedDirs)}) fs.rmSync(dir, { recursive: true, force: true });`,
  ].join('');

  const findings = result.errors.map((finding) => {
    const target = finding.resolvedTargetPath ?? '<missing>';
    return `- ${finding.code}: ${finding.symlinkPath} -> ${target}`;
  });

  return [
    '[e2e] node_modules dependency isolation preflight failed.',
    `Current repo root: ${result.errors[0]?.repoRoot ?? ''}`,
    `Polluted node_modules directories: ${pollutedDirs.join(', ')}`,
    'Findings:',
    ...findings,
    `Cleanup: node -e ${JSON.stringify(cleanupScript)}`,
    'Fallback: yarn install --frozen-lockfile',
  ].join('\n');
}

export async function assertE2eNodeModulesIsolation(params: {
  rootDir?: string;
  scope: E2eNodeModulesIsolationScope;
}): Promise<void> {
  const rootDir = params.rootDir ?? repoRootDir();
  const result = await validateNodeModulesIsolation({
    repoRoot: rootDir,
    nodeModulesDirs: resolveE2eNodeModulesIsolationDirs({ rootDir, scope: params.scope }),
  });
  if (!result.ok) {
    throw new Error(formatNodeModulesIsolationPreflightError(result));
  }
}
