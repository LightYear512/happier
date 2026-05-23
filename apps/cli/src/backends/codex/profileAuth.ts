import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ensureProfileSymlink } from '@/auth/provision/ensureProfileSymlink';
import { isProfileProvisioned } from '@/auth/provision/isProfileProvisioned';
import { resolveProvisionedProfileDir } from '@/auth/provision/profileProvisionPaths';
import { resolveCodexCliInvocation } from '@/backends/codex/utils/resolveCodexCliInvocation';
import { resolveConfiguredCodexHome } from '@/backends/codex/utils/resolveConfiguredCodexHome';
import type { CliProfileAuthProvider } from '@/backends/types';

const CODEX_PROFILE_AUTH_ENV_KEY = 'CODEX_HOME';

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

export const codexProfileAuthProvider: CliProfileAuthProvider = {
  providerId: 'codex',
  buildProfileDir: ({ activeServerDir, profileId }) => resolveProvisionedProfileDir({
    activeServerDir,
    backendId: 'codex',
    profileId,
  }),
  prepareProfileDir: ({ activeServerDir, profileId, processEnv = process.env }) => {
    const profileDir = codexProfileAuthProvider.buildProfileDir({ activeServerDir, profileId });
    const createdByThisRun = !existsSync(profileDir);
    mkdirSync(profileDir, { recursive: true });
    ensureCodexSharedConfigLinks({
      globalCodexHome: resolveConfiguredCodexHome(processEnv),
      profileDir,
    });
    return { profileDir, createdByThisRun };
  },
  buildIsolatedLoginContext: async ({ profileDir, processEnv = process.env }) => {
    const invocation = await resolveCodexCliInvocation({
      args: ['login'],
      processEnv,
      overrideEnvVarKeys: ['HAPPIER_CODEX_PATH'],
      targetLabel: 'Codex CLI',
    });
    return {
      command: invocation.command,
      args: invocation.args,
      env: {
        ...processEnv,
        [CODEX_PROFILE_AUTH_ENV_KEY]: profileDir,
      },
      allowlistedEnvKeys: [CODEX_PROFILE_AUTH_ENV_KEY],
    };
  },
  isProfileProvisioned: ({ activeServerDir, profileId }) => (
    isProfileProvisioned(profileId, 'codex', activeServerDir)
  ),
  cleanupFailedPrepare: ({ profileDir, createdByThisRun }) => {
    if (!createdByThisRun) return;
    rmSync(profileDir, { recursive: true, force: true });
  },
};

export const __test_codexProfileAuth = {
  ensureCodexSharedConfigLinks,
};
