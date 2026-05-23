import { existsSync, lstatSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createExecutableShim } from '@/testkit/fs/executableShim';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { provisionClaudeIsolatedDir } from './provisionClaudeIsolatedDir';

const envKeys = ['HOME', 'HAPPIER_HOME_DIR', 'PATH', 'HAPPIER_CLAUDE_PATH', 'CLAUDE_CONFIG_DIR', 'HAPPIER_CLAUDE_CONFIG_DIR'] as const;
const tempDirs = new Set<string>();
let envScope = createEnvKeyScope(envKeys);

async function createFakeClaudeCli(params: Readonly<{ exitCode?: number }>): Promise<string> {
  const isWindows = process.platform === 'win32';
  const contents = isWindows
    ? [
      '@echo off',
      'echo claude-login-url',
      `if not "${params.exitCode ?? 0}"=="0" exit /b ${params.exitCode ?? 0}`,
      'echo {"accessToken":"token"} > "%CLAUDE_CONFIG_DIR%\\.credentials.json"',
      '',
    ].join('\r\n')
    : [
      '#!/bin/sh',
      'echo claude-login-url',
      `if [ "${params.exitCode ?? 0}" != "0" ]; then exit ${params.exitCode ?? 0}; fi`,
      'printf \'{"accessToken":"token"}\' > "$CLAUDE_CONFIG_DIR/.credentials.json"',
      '',
    ].join('\n');
  const binPath = await createExecutableShim({
    dirPrefix: 'happier-provision-claude-bin-',
    fileName: isWindows ? 'claude.cmd' : 'claude',
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

describe('provisionClaudeIsolatedDir', () => {
  it('runs Claude login in an isolated profile config dir and backfills shared config links', async () => {
    const activeServerDir = await createTempDir('happier-provision-claude-active-');
    const globalClaudeConfigDir = await createTempDir('happier-provision-claude-global-');
    const homeDir = await createTempDir('happier-provision-claude-home-');
    tempDirs.add(activeServerDir);
    tempDirs.add(globalClaudeConfigDir);
    tempDirs.add(homeDir);
    const fakeClaude = await createFakeClaudeCli({});
    envScope.patch({
      HOME: homeDir,
      HAPPIER_HOME_DIR: homeDir,
      PATH: '',
      HAPPIER_CLAUDE_PATH: fakeClaude,
      HAPPIER_CLAUDE_CONFIG_DIR: globalClaudeConfigDir,
      CLAUDE_CONFIG_DIR: undefined,
    });

    const output: string[] = [];
    const result = await provisionClaudeIsolatedDir({
      profileId: 'work',
      machineId: 'm1',
      activeServerDir,
      processEnv: process.env,
      onPtyOutput: (chunk) => output.push(chunk),
    });

    expect(result.alreadyProvisioned).toBe(false);
    expect(result.profileDir).toBe(join(activeServerDir, 'profiles', 'native-cli', 'claude', 'work'));
    expect(existsSync(join(result.profileDir, '.credentials.json'))).toBe(true);
    expect(output.join('')).toContain('claude-login-url');
    expect(statSync(join(globalClaudeConfigDir, 'settings.json')).isFile()).toBe(true);
    expect(lstatSync(join(result.profileDir, 'settings.json')).isSymbolicLink()).toBe(true);
  });

  it('returns alreadyProvisioned without resolving or spawning Claude when credentials already exist', async () => {
    const activeServerDir = await createTempDir('happier-provision-claude-existing-');
    const homeDir = await createTempDir('happier-provision-claude-existing-home-');
    tempDirs.add(activeServerDir);
    tempDirs.add(homeDir);
    const profileDir = join(activeServerDir, 'profiles', 'native-cli', 'claude', 'work');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, '.credentials.json'), '{"accessToken":"token"}', 'utf8');
    envScope.patch({
      HOME: homeDir,
      HAPPIER_HOME_DIR: homeDir,
      PATH: '',
      HAPPIER_CLAUDE_PATH: '/missing/claude',
      HAPPIER_CLAUDE_CONFIG_DIR: undefined,
      CLAUDE_CONFIG_DIR: undefined,
    });

    await expect(provisionClaudeIsolatedDir({
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

  it('removes the isolated profile dir when login exits without credentials', async () => {
    const activeServerDir = await createTempDir('happier-provision-claude-fail-');
    const homeDir = await createTempDir('happier-provision-claude-fail-home-');
    tempDirs.add(activeServerDir);
    tempDirs.add(homeDir);
    const fakeClaude = await createFakeClaudeCli({ exitCode: 2 });
    envScope.patch({
      HOME: homeDir,
      HAPPIER_HOME_DIR: homeDir,
      PATH: '',
      HAPPIER_CLAUDE_PATH: fakeClaude,
      HAPPIER_CLAUDE_CONFIG_DIR: undefined,
      CLAUDE_CONFIG_DIR: undefined,
    });

    await expect(provisionClaudeIsolatedDir({
      profileId: 'work',
      machineId: 'm1',
      activeServerDir,
      processEnv: process.env,
      onPtyOutput: () => {},
    })).rejects.toThrow(/Claude login failed/);

    expect(existsSync(join(activeServerDir, 'profiles', 'native-cli', 'claude', 'work'))).toBe(false);
  });
});
