import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { configuration } from '@/configuration';
import {
  provisionClaudeIsolatedDir,
  type ProvisionClaudeParams,
  type ProvisionClaudeResult,
} from '@/auth/provision/provisionClaudeIsolatedDir';
import {
  provisionCodexIsolatedDir,
  type ProvisionCodexParams,
  type ProvisionCodexResult,
} from '@/auth/provision/provisionCodexIsolatedDir';
import {
  parseProvisionedProfileId,
  type ProvisionableProfileBackendId,
} from '@/auth/provision/profileProvisionPaths';
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
}>;

type ProfileProvisionError = Readonly<{
  type: 'error';
  errorCode: 'INVALID_REQUEST' | 'PROVISION_FAILED';
  errorMessage: string;
  ptyOutput?: string;
}>;

type ProfileProvisionResponse = ProfileProvisionSuccess | ProfileProvisionError;

export type ProfileProvisionDeps = Readonly<{
  provisionClaude: (params: ProvisionClaudeParams) => Promise<ProvisionClaudeResult>;
  provisionCodex: (params: ProvisionCodexParams) => Promise<ProvisionCodexResult>;
}>;

export type TryRecoverSuspendedSessionsFn = (
  profileId: string,
  backendId: ProvisionableProfileBackendId,
) => void | Promise<void>;

const PROFILE_PROVISION_PROGRESS_TTL_MS = 60_000;
const progressByKey = new Map<string, ProfileProvisionEntry>();
const inFlightByKey = new Map<string, Promise<ProfileProvisionResponse>>();

function progressKey(backendId: ProvisionableProfileBackendId, profileId: string): string {
  return `${backendId}:${profileId}`;
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

function parseProvisionBackendId(value: unknown): ProvisionableProfileBackendId | null {
  return value === 'claude' || value === 'codex' ? value : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runProfileProvision(params: Readonly<{
  deps: ProfileProvisionDeps;
  profileId: string;
  backendId: ProvisionableProfileBackendId;
  machineId: string;
  activeServerDir: string;
  processEnv: NodeJS.ProcessEnv;
  tryRecoverSuspendedSessions?: TryRecoverSuspendedSessionsFn | null;
}>): Promise<ProfileProvisionResponse> {
  const key = progressKey(params.backendId, params.profileId);
  const progress = ensureProgressEntry(key);
  progress.output = '';
  progress.completed = false;
  progress.completedAt = null;

  const outputChunks: string[] = [];
  const onPtyOutput = (chunk: string) => {
    outputChunks.push(chunk);
    progress.output += chunk;
  };

  try {
    const result = params.backendId === 'claude'
      ? await params.deps.provisionClaude({
        profileId: params.profileId,
        machineId: params.machineId,
        activeServerDir: params.activeServerDir,
        processEnv: params.processEnv,
        onPtyOutput,
      })
      : await params.deps.provisionCodex({
        profileId: params.profileId,
        machineId: params.machineId,
        activeServerDir: params.activeServerDir,
        processEnv: params.processEnv,
        onPtyOutput,
      });

    await params.tryRecoverSuspendedSessions?.(params.profileId, params.backendId);

    return {
      type: 'success',
      profileDir: result.profileDir,
      alreadyProvisioned: result.alreadyProvisioned,
      ptyOutput: outputChunks.join(''),
    };
  } catch (error) {
    return {
      type: 'error',
      errorCode: 'PROVISION_FAILED',
      errorMessage: toErrorMessage(error),
      ptyOutput: outputChunks.join(''),
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
    provisionClaude: opts.deps?.provisionClaude ?? provisionClaudeIsolatedDir,
    provisionCodex: opts.deps?.provisionCodex ?? provisionCodexIsolatedDir,
  };
  const activeServerDir = opts.activeServerDir ?? configuration.activeServerDir;
  const processEnv = opts.processEnv ?? process.env;

  rpcHandlerManager.registerHandler(RPC_METHODS.PROFILE_PROVISION, async (raw: unknown): Promise<ProfileProvisionResponse> => {
    const rawRecord = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const profileId = parseProvisionedProfileId(rawRecord.profileId);
    const backendId = parseProvisionBackendId(rawRecord.backendId);
    const machineId = typeof rawRecord.machineId === 'string' ? rawRecord.machineId.trim() : '';

    if (!profileId || !backendId) {
      return {
        type: 'error',
        errorCode: 'INVALID_REQUEST',
        errorMessage: 'Profile provision requires a profileId and supported backendId.',
      };
    }

    const key = progressKey(backendId, profileId);
    const existing = inFlightByKey.get(key);
    if (existing) return existing;

    const promise = runProfileProvision({
      deps,
      profileId,
      backendId,
      machineId,
      activeServerDir,
      processEnv,
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
      if (!profileId || !backendId) {
        return { output: '', completed: false };
      }

      const entry = progressByKey.get(progressKey(backendId, profileId));
      return {
        output: entry?.output ?? '',
        completed: entry?.completed ?? false,
      };
    },
  );
}
