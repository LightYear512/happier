import { randomUUID } from 'node:crypto';

import type { CatalogAgentId } from '@/backends/types';
import type { CliProfileAuthLoginContext } from '@/backends/types';

export type ProfileAuthSession = Readonly<{
  profileAuthSessionId: string;
  providerId: CatalogAgentId;
  profileId: string;
  profileDir: string;
  terminalKey: string;
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  initialInput?: string | null;
  terminalOutputResponder?: CliProfileAuthLoginContext['terminalOutputResponder'];
  cwd?: string;
  expiresAtMs: number;
}>;

export type ProfileAuthSessionStore = Readonly<{
  create: (params: Readonly<{
    providerId: CatalogAgentId;
    profileId: string;
    profileDir: string;
    terminalKey: string;
    loginContext: CliProfileAuthLoginContext;
  }>) => ProfileAuthSession;
  get: (profileAuthSessionId: string) => ProfileAuthSession | null;
  delete: (profileAuthSessionId: string) => void;
  reset: () => void;
}>;

export function createProfileAuthSessionStore(params?: Readonly<{
  createId?: () => string;
  now?: () => number;
  ttlMs?: number;
}>): ProfileAuthSessionStore {
  const createId = params?.createId ?? randomUUID;
  const now = params?.now ?? (() => Date.now());
  const ttlMs = Math.max(1, Math.trunc(params?.ttlMs ?? 15 * 60_000));
  const sessions = new Map<string, ProfileAuthSession>();

  const reapExpired = () => {
    const current = now();
    for (const [id, session] of sessions) {
      if (session.expiresAtMs <= current) {
        sessions.delete(id);
      }
    }
  };

  return {
    create: ({ providerId, profileId, profileDir, terminalKey, loginContext }) => {
      reapExpired();
      const profileAuthSessionId = createId();
      const session: ProfileAuthSession = {
        profileAuthSessionId,
        providerId,
        profileId,
        profileDir,
        terminalKey,
        command: loginContext.command,
        args: loginContext.args,
        env: loginContext.env,
        ...(loginContext.initialInput != null ? { initialInput: loginContext.initialInput } : {}),
        ...(loginContext.terminalOutputResponder ? { terminalOutputResponder: loginContext.terminalOutputResponder } : {}),
        ...(loginContext.cwd ? { cwd: loginContext.cwd } : {}),
        expiresAtMs: now() + ttlMs,
      };
      sessions.set(profileAuthSessionId, session);
      return session;
    },
    get: (profileAuthSessionId) => {
      reapExpired();
      return sessions.get(profileAuthSessionId) ?? null;
    },
    delete: (profileAuthSessionId) => {
      sessions.delete(profileAuthSessionId);
    },
    reset: () => {
      sessions.clear();
    },
  };
}

export const profileAuthSessions = createProfileAuthSessionStore();
