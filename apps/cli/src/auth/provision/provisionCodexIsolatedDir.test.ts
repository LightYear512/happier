import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createExecutableShim } from '@/testkit/fs/executableShim';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { provisionCodexIsolatedDir } from './provisionCodexIsolatedDir';

const envKeys = ['HOME', 'HAPPIER_HOME_DIR', 'PATH', 'HAPPIER_CODEX_PATH', 'CODEX_HOME'] as const;
const tempDirs = new Set<string>();
let envScope = createEnvKeyScope(envKeys);

async function createFakeCodexCli(params: Readonly<{ exitCode?: number }>): Promise<string> {
  const isWindows = process.platform === 'win32';
  const contents = isWindows
    ? [
      '@echo off',
      'echo codex-login-url',
      `if not "${params.exitCode ?? 0}"=="0" exit /b ${params.exitCode ?? 0}`,
      'echo {"tokens":{"access_token":"token"}} > "%CODEX_HOME%\\auth.json"',
      '',
    ].join('\r\n')
    : [
      '#!/bin/sh',
      'echo codex-login-url',
      `if [ "${params.exitCode ?? 0}" != "0" ]; then exit ${params.exitCode ?? 0}; fi`,
      'printf \'{"tokens":{"access_token":"token"}}\' > "$CODEX_HOME/auth.json"',
      '',
    ].join('\n');
  const binPath = await createExecutableShim({
    dirPrefix: 'happier-provision-codex-bin-',
    fileName: isWindows ? 'codex.cmd' : 'codex',
    contents,
  });
  tempDirs.add(dirname(binPath));
  return binPath;
}

afterEach(async () => {
  envScope.restore();
  envScope = createEnvKeyScope(envKeys);
  for (const dir of tempDirs) {
    await removeTempDir(dir);
  }
  tempDirs.clear();
});

describe('provisionCodexIsolatedDir', () => {
  it('runs Codex login in an isolated CODEX_HOME without creating missing file targets as directories', async () => {
    const activeServerDir = await createTempDir('happier-provision-codex-active-');
    const globalCodexHome = await createTempDir('happier-provision-codex-global-');
    const homeDir = await createTempDir('happier-provision-codex-home-');
    tempDirs.add(activeServerDir);
    tempDirs.add(globalCodexHome);
    tempDirs.add(homeDir);
    const fakeCodex = await createFakeCodexCli({});
    envScope.patch({
      HOME: homeDir,
      HAPPIER_HOME_DIR: homeDir,
      PATH: '',
      HAPPIER_CODEX_PATH: fakeCodex,
      CODEX_HOME: globalCodexHome,
    });

    const output: string[] = [];
    const result = await provisionCodexIsolatedDir({
      profileId: 'work',
      machineId: 'm1',
      activeServerDir,
      processEnv: process.env,
      onPtyOutput: (chunk) => output.push(chunk),
    });

    expect(result.alreadyProvisioned).toBe(false);
    expect(result.profileDir).toBe(join(activeServerDir, 'profiles', 'native-cli', 'codex', 'work'));
    expect(existsSync(join(result.profileDir, 'auth.json'))).toBe(true);
    expect(output.join('')).toContain('codex-login-url');
    expect(existsSync(join(globalCodexHome, 'config.toml'))).toBe(false);
    expect(lstatSync(join(result.profileDir, 'config.toml')).isSymbolicLink()).toBe(true);
  });

  it('returns alreadyProvisioned without resolving or spawning Codex when auth.json already exists', async () => {
    const activeServerDir = await createTempDir('happier-provision-codex-existing-');
    const homeDir = await createTempDir('happier-provision-codex-existing-home-');
    tempDirs.add(activeServerDir);
    tempDirs.add(homeDir);
    const profileDir = join(activeServerDir, 'profiles', 'native-cli', 'codex', 'work');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'auth.json'), '{"tokens":{"access_token":"token"}}', 'utf8');
    envScope.patch({
      HOME: homeDir,
      HAPPIER_HOME_DIR: homeDir,
      PATH: '',
      HAPPIER_CODEX_PATH: '/missing/codex',
      CODEX_HOME: undefined,
    });

    await expect(provisionCodexIsolatedDir({
      profileId: 'work',
      machineId: 'm1',
      activeServerDir,
      processEnv: process.env,
      onPtyOutput: () => {},
    })).resolves.toEqual({
      profileDir,
      alreadyProvisioned: true,
    });
  });

  it('removes the isolated profile dir when login exits without auth.json', async () => {
    const activeServerDir = await createTempDir('happier-provision-codex-fail-');
    const homeDir = await createTempDir('happier-provision-codex-fail-home-');
    tempDirs.add(activeServerDir);
    tempDirs.add(homeDir);
    const fakeCodex = await createFakeCodexCli({ exitCode: 2 });
    envScope.patch({
      HOME: homeDir,
      HAPPIER_HOME_DIR: homeDir,
      PATH: '',
      HAPPIER_CODEX_PATH: fakeCodex,
      CODEX_HOME: undefined,
    });

    await expect(provisionCodexIsolatedDir({
      profileId: 'work',
      machineId: 'm1',
      activeServerDir,
      processEnv: process.env,
      onPtyOutput: () => {},
    })).rejects.toThrow(/Codex login failed/);

    expect(existsSync(join(activeServerDir, 'profiles', 'native-cli', 'codex', 'work'))).toBe(false);
  });
});
