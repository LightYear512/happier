import type { ProvisionableProfileBackendId } from '@/auth/provision/profileProvisionPaths';
import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from '@/rpc/handlers/registerSessionHandlers';

export type SuspendedProfileSession = Readonly<{
  sessionId: string;
  backendId: ProvisionableProfileBackendId;
  profileId: string;
  spawnOptions: SpawnSessionOptions;
}>;

export type SuspendedProfileSessionRecoveryResult = Readonly<{
  recoveredSessionIds: string[];
  failedSessionIds: string[];
}>;

export function createSuspendedProfileSessionRegistry(params: Readonly<{
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  logDebug?: (message: string, payload?: unknown) => void;
}>) {
  const suspendedBySessionId = new Map<string, SuspendedProfileSession>();

  return {
    add(entry: SuspendedProfileSession): void {
      suspendedBySessionId.set(entry.sessionId, entry);
    },

    remove(sessionId: string): void {
      suspendedBySessionId.delete(sessionId);
    },

    list(): SuspendedProfileSession[] {
      return Array.from(suspendedBySessionId.values());
    },

    async recover(recoverParams: Readonly<{
      backendId: ProvisionableProfileBackendId;
      profileId: string;
    }>): Promise<SuspendedProfileSessionRecoveryResult> {
      const candidates = Array.from(suspendedBySessionId.values()).filter((entry) => (
        entry.backendId === recoverParams.backendId && entry.profileId === recoverParams.profileId
      ));
      const recoveredSessionIds: string[] = [];
      const failedSessionIds: string[] = [];

      for (const entry of candidates) {
        suspendedBySessionId.delete(entry.sessionId);
        try {
          const result = await params.spawnSession(entry.spawnOptions);
          if (result.type === 'success') {
            recoveredSessionIds.push(entry.sessionId);
            continue;
          }
          failedSessionIds.push(entry.sessionId);
          suspendedBySessionId.set(entry.sessionId, entry);
        } catch (error) {
          failedSessionIds.push(entry.sessionId);
          suspendedBySessionId.set(entry.sessionId, entry);
          params.logDebug?.('[DAEMON RUN] Failed to recover suspended profile session', error);
        }
      }

      return { recoveredSessionIds, failedSessionIds };
    },
  };
}
