import type { SwitchProfileEvent } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { isProfileProvisioned } from '@/auth/provision/isProfileProvisioned';
import {
  parseProvisionedProfileId,
  type ProvisionableProfileBackendId,
} from '@/auth/provision/profileProvisionPaths';
import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from '@/rpc/handlers/registerSessionHandlers';
import { logger } from '@/ui/logger';

export type { SwitchProfileEvent };

type SwitchableSessionProfileBackendId = ProvisionableProfileBackendId;

export type SessionSwitchProfileResult =
  | Readonly<{
    type: 'success';
    events: SwitchProfileEvent[];
  }>
  | Readonly<{
    type: 'error';
    errorCode:
      | 'INVALID_REQUEST'
      | 'SESSION_NOT_FOUND'
      | 'UNSUPPORTED_BACKEND'
      | 'PROFILE_NOT_PROVISIONED'
      | 'SWITCH_SPAWN_FAILED';
    errorMessage: string;
    events: SwitchProfileEvent[];
  }>;

export type SessionSwitchProfileDeps = Readonly<{
  activeServerDir: string;
  findSessionByHappyId: (sessionId: string) => Readonly<{
    backendId: string;
    profileId: string | null | undefined;
    spawnOptions: SpawnSessionOptions;
  }> | null;
  stopSession: (sessionId: string) => Promise<boolean>;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  addSuspendedSession: (
    sessionId: string,
    backendId: SwitchableSessionProfileBackendId,
    profileId: string,
    spawnOptions: SpawnSessionOptions,
  ) => void;
  removeSuspendedSession: (sessionId: string) => void;
  broadcastSwitchEvent?: (sessionId: string, event: SwitchProfileEvent) => void;
}>;

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveSwitchableBackendId(backendId: string): SwitchableSessionProfileBackendId | null {
  return backendId === 'claude' || backendId === 'codex' ? backendId : null;
}

function buildSwitchSpawnOptions(params: Readonly<{
  sessionId: string;
  targetProfileId: string;
  spawnOptions: SpawnSessionOptions;
}>): SpawnSessionOptions {
  return {
    ...params.spawnOptions,
    profileId: params.targetProfileId,
    existingSessionId: params.sessionId,
    sessionId: undefined,
    resume: undefined,
    existingSessionAttachPayload: undefined,
  };
}

export function registerSessionSwitchProfileHandler(
  rpcHandlerManager: RpcHandlerRegistrar,
  deps: SessionSwitchProfileDeps,
): void {
  rpcHandlerManager.registerHandler(RPC_METHODS.SESSION_SWITCH_PROFILE, async (raw: unknown): Promise<SessionSwitchProfileResult> => {
    const rawRecord = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const sessionId = parseNonEmptyString(rawRecord.sessionId);
    const targetProfileId = parseProvisionedProfileId(rawRecord.targetProfileId);
    const events: SwitchProfileEvent[] = [];

    const emit = (event: SwitchProfileEvent) => {
      events.push(event);
      try {
        deps.broadcastSwitchEvent?.(sessionId ?? '', event);
      } catch (error) {
        logger.debug('[DAEMON] Session profile switch broadcast failed', error);
      }
    };

    if (!sessionId || !targetProfileId) {
      return {
        type: 'error',
        errorCode: 'INVALID_REQUEST',
        errorMessage: 'sessionId and targetProfileId are required.',
        events,
      };
    }

    const session = deps.findSessionByHappyId(sessionId);
    if (!session) {
      return {
        type: 'error',
        errorCode: 'SESSION_NOT_FOUND',
        errorMessage: `Session ${sessionId} was not found on this daemon.`,
        events,
      };
    }

    const backendId = resolveSwitchableBackendId(session.backendId);
    if (!backendId) {
      return {
        type: 'error',
        errorCode: 'UNSUPPORTED_BACKEND',
        errorMessage: `Session provider ${session.backendId} does not support isolated profile switching.`,
        events,
      };
    }

    if (!isProfileProvisioned(targetProfileId, backendId, deps.activeServerDir)) {
      return {
        type: 'error',
        errorCode: 'PROFILE_NOT_PROVISIONED',
        errorMessage: `Profile ${targetProfileId} is not provisioned for ${backendId} on this machine.`,
        events,
      };
    }

    const nextSpawnOptions = buildSwitchSpawnOptions({
      sessionId,
      targetProfileId,
      spawnOptions: session.spawnOptions,
    });

    deps.removeSuspendedSession(sessionId);
    emit({ type: 'switch_pending', targetProfileId });

    try {
      await deps.stopSession(sessionId);
    } catch (error) {
      logger.debug('[DAEMON] Stop before session profile switch failed; continuing with respawn', error);
    }

    const spawnResult = await deps.spawnSession(nextSpawnOptions);
    if (spawnResult.type === 'success') {
      emit({ type: 'switch_complete', targetProfileId });
      return { type: 'success', events };
    }

    deps.addSuspendedSession(sessionId, backendId, targetProfileId, nextSpawnOptions);
    emit({ type: 'switch_interrupted', reason: 'spawn_failed', targetProfileId });
    return {
      type: 'error',
      errorCode: 'SWITCH_SPAWN_FAILED',
      errorMessage: spawnResult.type === 'error' && spawnResult.errorMessage
        ? spawnResult.errorMessage
        : 'Session respawn failed during profile switch.',
      events,
    };
  });
}
