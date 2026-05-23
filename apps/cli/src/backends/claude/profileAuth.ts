import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ensureProfileSymlink } from '@/auth/provision/ensureProfileSymlink';
import { isProfileProvisioned } from '@/auth/provision/isProfileProvisioned';
import { resolveProvisionedProfileDir } from '@/auth/provision/profileProvisionPaths';
import { resolveConfiguredClaudeConfigDir } from '@/backends/claude/utils/resolveConfiguredClaudeConfigDir';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import type { CliProfileAuthProvider } from '@/backends/types';

const CLAUDE_PROFILE_AUTH_ENV_KEY = 'CLAUDE_CONFIG_DIR';

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

function buildClaudeProfileAuthEnv(params: Readonly<{
  processEnv: NodeJS.ProcessEnv;
  profileDir: string;
}>): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...params.processEnv,
    [CLAUDE_PROFILE_AUTH_ENV_KEY]: params.profileDir,
  };
  delete childEnv.HAPPIER_CLAUDE_CONFIG_DIR;
  return childEnv;
}

export const claudeProfileAuthProvider: CliProfileAuthProvider = {
  providerId: 'claude',
  buildProfileDir: ({ activeServerDir, profileId }) => resolveProvisionedProfileDir({
    activeServerDir,
    backendId: 'claude',
    profileId,
  }),
  prepareProfileDir: ({ activeServerDir, profileId, processEnv = process.env }) => {
    const profileDir = claudeProfileAuthProvider.buildProfileDir({ activeServerDir, profileId });
    const createdByThisRun = !existsSync(profileDir);
    mkdirSync(profileDir, { recursive: true });
    ensureClaudeSharedConfigLinks({
      globalConfigDir: resolveConfiguredClaudeConfigDir({ env: processEnv }),
      profileDir,
    });
    return { profileDir, createdByThisRun };
  },
  buildIsolatedLoginContext: ({ profileDir, processEnv = process.env }) => {
    const launchSpec = requireProviderCliLaunchSpec('claude', { processEnv });
    return {
      command: launchSpec.command,
      args: launchSpec.args,
      initialInput: '/login\r',
      env: buildClaudeProfileAuthEnv({ processEnv, profileDir }),
      allowlistedEnvKeys: [CLAUDE_PROFILE_AUTH_ENV_KEY],
    };
  },
  isProfileProvisioned: ({ activeServerDir, profileId }) => (
    isProfileProvisioned(profileId, 'claude', activeServerDir)
  ),
  cleanupFailedPrepare: ({ profileDir, createdByThisRun }) => {
    if (!createdByThisRun) return;
    rmSync(profileDir, { recursive: true, force: true });
  },
};

export const __test_claudeProfileAuth = {
  ensureClaudeSharedConfigLinks,
  buildClaudeProfileAuthEnv,
};
