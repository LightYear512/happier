import { mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { resolveConfiguredClaudeConfigDir } from '@/backends/claude/utils/resolveConfiguredClaudeConfigDir';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';

import { ensureProfileSymlink } from './ensureProfileSymlink';
import { isProfileProvisioned } from './isProfileProvisioned';
import { resolveProvisionedProfileDir } from './profileProvisionPaths';

export type ProvisionClaudeParams = Readonly<{
  profileId: string;
  machineId: string;
  activeServerDir: string;
  processEnv?: NodeJS.ProcessEnv;
  onPtyOutput: (chunk: string) => void;
  signal?: AbortSignal;
}>;

export type ProvisionClaudeResult = Readonly<{
  profileDir: string;
  alreadyProvisioned: boolean;
}>;

function ensureClaudeSharedConfigLinks(params: Readonly<{
  globalConfigDir: string;
  profileDir: string;
}>): void {
  for (const entry of [
    { name: 'projects', targetKind: 'directory' as const },
    { name: 'skills', targetKind: 'directory' as const },
    { name: 'agents', targetKind: 'directory' as const },
    { name: 'commands', targetKind: 'directory' as const },
  ]) {
    ensureProfileSymlink({
      target: join(params.globalConfigDir, entry.name),
      linkPath: join(params.profileDir, entry.name),
      targetKind: entry.targetKind,
    });
  }

  ensureProfileSymlink({
    target: join(params.globalConfigDir, 'settings.json'),
    linkPath: join(params.profileDir, 'settings.json'),
    targetKind: 'file',
    createMissingFileContent: '{}',
  });
}

function buildClaudeProvisionEnv(params: Readonly<{
  processEnv: NodeJS.ProcessEnv;
  profileDir: string;
}>): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...params.processEnv,
    CLAUDE_CONFIG_DIR: params.profileDir,
  };
  delete childEnv.HAPPIER_CLAUDE_CONFIG_DIR;
  return childEnv;
}

function waitForProvisionChild(params: Readonly<{
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  onPtyOutput: (chunk: string) => void;
  signal?: AbortSignal;
}>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, [...params.args], {
      env: params.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    const abortHandler = () => {
      child.kill('SIGTERM');
    };

    child.stdout.on('data', (chunk: Buffer) => params.onPtyOutput(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => params.onPtyOutput(chunk.toString()));
    child.once('error', reject);
    child.once('close', resolve);
    params.signal?.addEventListener('abort', abortHandler, { once: true });
    child.once('close', () => {
      params.signal?.removeEventListener('abort', abortHandler);
    });
    child.once('error', () => {
      params.signal?.removeEventListener('abort', abortHandler);
    });
  });
}

export async function provisionClaudeIsolatedDir(
  params: ProvisionClaudeParams,
): Promise<ProvisionClaudeResult> {
  const processEnv = params.processEnv ?? process.env;
  const profileDir = resolveProvisionedProfileDir({
    activeServerDir: params.activeServerDir,
    backendId: 'claude',
    profileId: params.profileId,
  });

  mkdirSync(profileDir, { recursive: true });
  ensureClaudeSharedConfigLinks({
    globalConfigDir: resolveConfiguredClaudeConfigDir({ env: processEnv }),
    profileDir,
  });

  if (isProfileProvisioned(params.profileId, 'claude', params.activeServerDir)) {
    return { profileDir, alreadyProvisioned: true };
  }

  const launchSpec = requireProviderCliLaunchSpec('claude', { processEnv });
  const exitCode = await waitForProvisionChild({
    command: launchSpec.command,
    args: [...launchSpec.args, '/login'],
    env: buildClaudeProvisionEnv({ processEnv, profileDir }),
    onPtyOutput: params.onPtyOutput,
    signal: params.signal,
  });

  if (exitCode === 0 && isProfileProvisioned(params.profileId, 'claude', params.activeServerDir)) {
    return { profileDir, alreadyProvisioned: false };
  }

  rmSync(profileDir, { recursive: true, force: true });
  throw new Error(
    exitCode === null
      ? `Claude login was cancelled (profile: ${params.profileId})`
      : `Claude login failed with exit code ${exitCode} (profile: ${params.profileId})`,
  );
}
