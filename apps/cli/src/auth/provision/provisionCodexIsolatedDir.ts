import { mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { resolveCodexCliInvocation } from '@/backends/codex/utils/resolveCodexCliInvocation';
import { resolveConfiguredCodexHome } from '@/backends/codex/utils/resolveConfiguredCodexHome';

import { ensureProfileSymlink } from './ensureProfileSymlink';
import { isProfileProvisioned } from './isProfileProvisioned';
import { resolveProvisionedProfileDir } from './profileProvisionPaths';

export type ProvisionCodexParams = Readonly<{
  profileId: string;
  machineId: string;
  activeServerDir: string;
  processEnv?: NodeJS.ProcessEnv;
  onPtyOutput: (chunk: string) => void;
  signal?: AbortSignal;
}>;

export type ProvisionCodexResult = Readonly<{
  profileDir: string;
  alreadyProvisioned: boolean;
}>;

function ensureCodexSharedConfigLinks(params: Readonly<{
  globalCodexHome: string;
  profileDir: string;
}>): void {
  ensureProfileSymlink({
    target: join(params.globalCodexHome, 'sessions'),
    linkPath: join(params.profileDir, 'sessions'),
    targetKind: 'directory',
  });

  for (const fileName of ['config.toml', 'models_cache.json']) {
    ensureProfileSymlink({
      target: join(params.globalCodexHome, fileName),
      linkPath: join(params.profileDir, fileName),
      targetKind: 'file',
    });
  }
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

export async function provisionCodexIsolatedDir(
  params: ProvisionCodexParams,
): Promise<ProvisionCodexResult> {
  const processEnv = params.processEnv ?? process.env;
  const profileDir = resolveProvisionedProfileDir({
    activeServerDir: params.activeServerDir,
    backendId: 'codex',
    profileId: params.profileId,
  });

  mkdirSync(profileDir, { recursive: true });
  ensureCodexSharedConfigLinks({
    globalCodexHome: resolveConfiguredCodexHome(processEnv),
    profileDir,
  });

  if (isProfileProvisioned(params.profileId, 'codex', params.activeServerDir)) {
    return { profileDir, alreadyProvisioned: true };
  }

  const invocation = await resolveCodexCliInvocation({
    args: ['login'],
    processEnv,
    overrideEnvVarKeys: ['HAPPIER_CODEX_PATH'],
    targetLabel: 'Codex CLI',
  });
  const exitCode = await waitForProvisionChild({
    command: invocation.command,
    args: invocation.args,
    env: {
      ...processEnv,
      CODEX_HOME: profileDir,
    },
    onPtyOutput: params.onPtyOutput,
    signal: params.signal,
  });

  if (exitCode === 0 && isProfileProvisioned(params.profileId, 'codex', params.activeServerDir)) {
    return { profileDir, alreadyProvisioned: false };
  }

  rmSync(profileDir, { recursive: true, force: true });
  throw new Error(
    exitCode === null
      ? `Codex login was cancelled (profile: ${params.profileId})`
      : `Codex login failed with exit code ${exitCode} (profile: ${params.profileId})`,
  );
}
