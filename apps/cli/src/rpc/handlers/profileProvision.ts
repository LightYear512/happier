import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { configuration } from '@/configuration';
import { parseProvisionedProfileId } from '@/auth/provision/profileProvisionPaths';
import { getProfileAuthProvider as getCatalogProfileAuthProvider } from '@/backends/catalog';
import type { CatalogAgentId, CliProfileAuthProvider } from '@/backends/types';
import { CATALOG_AGENT_IDS } from '@/backends/types';
import { profileAuthSessions, type ProfileAuthSessionStore } from '@/auth/provision/profileAuthSessionStore';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

type ProfileProvisionEntry = {
  output: string;
  completed: boolean;
  completedAt: number | null;
};

type ProfileProvisionSuccess = Readonly<{
  type: 'success';
  profileDir: string;
  alreadyProvisioned: boolean;
  ptyOutput: string;
  profileAuthSessionId: string | null;
  terminalKey: string;
}>;

type ProfileProvisionError = Readonly<{
  type: 'error';
  errorCode: 'INVALID_REQUEST' | 'PROVISION_FAILED';
  errorMessage: string;
  ptyOutput?: string;
}>;

type ProfileProvisionResponse = ProfileProvisionSuccess | ProfileProvisionError;

function buildProfileAuthTerminalKey(params: Readonly<{
  machineId: string;
  backendId: string;
  profileId: string;
}>): string {
  return `profile-login:${params.machineId}:${params.backendId}:${params.profileId}`;
}

export type ProfileProvisionDeps = Readonly<{
  getProfileAuthProvider: (backendId: CatalogAgentId) => Promise<CliProfileAuthProvider | null>;
  profileAuthSessions: ProfileAuthSessionStore;
}>;

export type TryRecoverSuspendedSessionsFn = (
  profileId: string,
  backendId: CatalogAgentId,
) => void | Promise<void>;

const PROFILE_PROVISION_PROGRESS_TTL_MS = 60_000;
const progressByKey = new Map<string, ProfileProvisionEntry>();
const inFlightByKey = new Map<string, Promise<ProfileProvisionResponse>>();

function progressKey(backendId: string, profileId: string, machineId = ''): string {
  return `${machineId}:${backendId}:${profileId}`;
}

function ensureProgressEntry(key: string): ProfileProvisionEntry {
  const existing = progressByKey.get(key);
  if (!existing) {
    const created = { output: '', completed: false, completedAt: null };
    progressByKey.set(key, created);
    return created;
  }

  if (
    existing.completed
    && existing.completedAt !== null
    && Date.now() - existing.completedAt > PROFILE_PROVISION_PROGRESS_TTL_MS
  ) {
    existing.output = '';
    existing.completed = false;
    existing.completedAt = null;
  }
  return existing;
}

function markProgressCompleted(key: string): void {
  const entry = progressByKey.get(key);
  if (!entry) return;
  entry.completed = true;
  entry.completedAt = Date.now();

  for (const [entryKey, peer] of progressByKey.entries()) {
    if (
      peer.completed
      && peer.completedAt !== null
      && Date.now() - peer.completedAt > PROFILE_PROVISION_PROGRESS_TTL_MS
    ) {
      progressByKey.delete(entryKey);
    }
  }
}

export const __test_profileProvisionProgress = {
  progressKey,
  ensureProgressEntry,
  markProgressCompleted,
  reset: () => {
    progressByKey.clear();
    inFlightByKey.clear();
  },
  ttlMs: PROFILE_PROVISION_PROGRESS_TTL_MS,
};

function parseProvisionBackendId(value: unknown): CatalogAgentId | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return (CATALOG_AGENT_IDS as readonly string[]).includes(trimmed) ? trimmed as CatalogAgentId : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runProfileProvision(params: Readonly<{
  deps: ProfileProvisionDeps;
  profileId: string;
  backendId: CatalogAgentId;
  machineId: string;
  activeServerDir: string;
  processEnv: NodeJS.ProcessEnv;
  verifyOnly: boolean;
  profileAuthSessionId?: string | null;
  tryRecoverSuspendedSessions?: TryRecoverSuspendedSessionsFn | null;
}>): Promise<ProfileProvisionResponse> {
  const key = progressKey(params.backendId, params.profileId, params.machineId);
  const progress = ensureProgressEntry(key);
  progress.output = '';
  progress.completed = false;
  progress.completedAt = null;

  try {
    const provider = await params.deps.getProfileAuthProvider(params.backendId);
    if (!provider) {
      return {
        type: 'error',
        errorCode: 'INVALID_REQUEST',
        errorMessage: 'Profile provision requires a backend that supports native CLI profile authentication.',
        ptyOutput: '',
      };
    }

    const profileDir = provider.buildProfileDir({
      activeServerDir: params.activeServerDir,
      profileId: params.profileId,
    });
    const alreadyProvisioned = provider.isProfileProvisioned({
      activeServerDir: params.activeServerDir,
      profileId: params.profileId,
    });
    if (params.verifyOnly) {
      if (!alreadyProvisioned) {
        if (params.profileAuthSessionId) {
          params.deps.profileAuthSessions.delete(params.profileAuthSessionId);
        }
        return {
          type: 'error',
          errorCode: 'PROVISION_FAILED',
          errorMessage: 'Profile credentials were not found after native CLI login.',
          ptyOutput: progress.output,
        };
      }
      if (params.profileAuthSessionId) {
        params.deps.profileAuthSessions.delete(params.profileAuthSessionId);
      }
      await params.tryRecoverSuspendedSessions?.(params.profileId, params.backendId);
      return {
        type: 'success',
        profileDir,
        alreadyProvisioned: true,
        ptyOutput: progress.output,
        profileAuthSessionId: null,
        terminalKey: buildProfileAuthTerminalKey(params),
      };
    }

    const terminalKey = buildProfileAuthTerminalKey(params);
    const prepared = provider.prepareProfileDir({
      activeServerDir: params.activeServerDir,
      profileId: params.profileId,
      processEnv: params.processEnv,
    });
    const loginContext = alreadyProvisioned
      ? null
      : await provider.buildIsolatedLoginContext({
        profileDir: prepared.profileDir,
        processEnv: params.processEnv,
      });
    const profileAuthSession = loginContext
      ? params.deps.profileAuthSessions.create({
        providerId: provider.providerId,
        profileId: params.profileId,
        profileDir: prepared.profileDir,
        terminalKey,
        loginContext,
      })
      : null;

    if (alreadyProvisioned) {
      await params.tryRecoverSuspendedSessions?.(params.profileId, params.backendId);
    }

    return {
      type: 'success',
      profileDir: prepared.profileDir,
      alreadyProvisioned,
      ptyOutput: progress.output,
      profileAuthSessionId: profileAuthSession?.profileAuthSessionId ?? null,
      terminalKey,
    };
  } catch (error) {
    return {
      type: 'error',
      errorCode: 'PROVISION_FAILED',
      errorMessage: toErrorMessage(error),
      ptyOutput: progress.output,
    };
  } finally {
    markProgressCompleted(key);
  }
}

export function registerProfileProvisionHandlers(
  rpcHandlerManager: RpcHandlerRegistrar,
  opts: Readonly<{
    deps?: Partial<ProfileProvisionDeps>;
    tryRecoverSuspendedSessions?: TryRecoverSuspendedSessionsFn | null;
    activeServerDir?: string;
    processEnv?: NodeJS.ProcessEnv;
  }> = {},
): void {
  const deps: ProfileProvisionDeps = {
    getProfileAuthProvider: opts.deps?.getProfileAuthProvider ?? getCatalogProfileAuthProvider,
    profileAuthSessions: opts.deps?.profileAuthSessions ?? profileAuthSessions,
  };
  const activeServerDir = opts.activeServerDir ?? configuration.activeServerDir;
  const processEnv = opts.processEnv ?? process.env;

  rpcHandlerManager.registerHandler(RPC_METHODS.PROFILE_PROVISION, async (raw: unknown): Promise<ProfileProvisionResponse> => {
    const rawRecord = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const profileId = parseProvisionedProfileId(rawRecord.profileId);
    const backendId = parseProvisionBackendId(rawRecord.backendId);
    const machineId = typeof rawRecord.machineId === 'string' ? rawRecord.machineId.trim() : '';
    const verifyOnly = rawRecord.verifyOnly === true;
    const profileAuthSessionId = typeof rawRecord.profileAuthSessionId === 'string'
      ? rawRecord.profileAuthSessionId.trim()
      : null;

    if (!profileId || !backendId) {
      return {
        type: 'error',
        errorCode: 'INVALID_REQUEST',
        errorMessage: 'Profile provision requires a profileId and supported backendId.',
      };
    }

    const key = progressKey(backendId, profileId, machineId);
    const existing = inFlightByKey.get(key);
    if (existing) return existing;

    const promise = runProfileProvision({
      deps,
      profileId,
      backendId,
      machineId,
      activeServerDir,
      processEnv,
      verifyOnly,
      profileAuthSessionId,
      tryRecoverSuspendedSessions: opts.tryRecoverSuspendedSessions ?? null,
    }).finally(() => {
      inFlightByKey.delete(key);
    });
    inFlightByKey.set(key, promise);
    return promise;
  });

  rpcHandlerManager.registerHandler(
    RPC_METHODS.PROFILE_PROVISION_POLL_PROGRESS,
    async (raw: unknown): Promise<Readonly<{ output: string; completed: boolean }>> => {
      const rawRecord = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
      const profileId = parseProvisionedProfileId(rawRecord.profileId);
      const backendId = parseProvisionBackendId(rawRecord.backendId);
      const machineId = typeof rawRecord.machineId === 'string' ? rawRecord.machineId.trim() : '';
      if (!profileId || !backendId) {
        return { output: '', completed: false };
      }

      const entry = progressByKey.get(progressKey(backendId, profileId, machineId));
      return {
        output: entry?.output ?? '',
        completed: entry?.completed ?? false,
      };
    },
  );
}
