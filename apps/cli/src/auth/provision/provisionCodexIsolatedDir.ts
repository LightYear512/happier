import { spawn } from 'node:child_process';

import { codexProfileAuthProvider } from '@/backends/codex/profileAuth';

import { isProfileProvisioned } from './isProfileProvisioned';

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

function waitForProvisionChild(params: Readonly<{
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  initialInput?: string | null;
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
    if (params.initialInput) {
      child.stdin.write(params.initialInput);
    }
    child.stdin.end();
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
  const prepared = codexProfileAuthProvider.prepareProfileDir({
    activeServerDir: params.activeServerDir,
    profileId: params.profileId,
    processEnv,
  });
  const profileDir = prepared.profileDir;

  if (isProfileProvisioned(params.profileId, 'codex', params.activeServerDir)) {
    return { profileDir, alreadyProvisioned: true };
  }

  const loginContext = await codexProfileAuthProvider.buildIsolatedLoginContext({
    profileDir,
    processEnv,
  });
  const exitCode = await waitForProvisionChild({
    command: loginContext.command,
    args: loginContext.args,
    env: loginContext.env,
    initialInput: loginContext.initialInput,
    onPtyOutput: params.onPtyOutput,
    signal: params.signal,
  });

  if (exitCode === 0 && isProfileProvisioned(params.profileId, 'codex', params.activeServerDir)) {
    return { profileDir, alreadyProvisioned: false };
  }

  codexProfileAuthProvider.cleanupFailedPrepare?.(prepared);
  throw new Error(
    exitCode === null
      ? `Codex login was cancelled (profile: ${params.profileId})`
      : `Codex login failed with exit code ${exitCode} (profile: ${params.profileId})`,
  );
}
