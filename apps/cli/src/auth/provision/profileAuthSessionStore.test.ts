import { describe, expect, it } from 'vitest';

import { createProfileAuthSessionStore } from './profileAuthSessionStore';

describe('profileAuthSessionStore', () => {
  it('expires profile auth sessions after the configured ttl', () => {
    let nowMs = 10_000;
    const store = createProfileAuthSessionStore({
      createId: () => 'auth-1',
      now: () => nowMs,
      ttlMs: 1_000,
    });
    const terminalOutputResponder = () => '/login\r';

    const session = store.create({
      providerId: 'claude',
      profileId: 'work',
      profileDir: '/profiles/native-cli/claude/work',
      terminalKey: 'profile-login:machine-a:claude:work',
      loginContext: {
        command: '/bin/claude',
        args: [],
        env: { CLAUDE_CONFIG_DIR: '/profiles/native-cli/claude/work' },
        allowlistedEnvKeys: ['CLAUDE_CONFIG_DIR'],
        terminalOutputResponder,
      },
    });

    expect(store.get(session.profileAuthSessionId)).toEqual(session);
    expect(session.terminalOutputResponder).toBe(terminalOutputResponder);
    nowMs += 1_001;
    expect(store.get(session.profileAuthSessionId)).toBeNull();
  });
});
