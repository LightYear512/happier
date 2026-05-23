import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveClaudeConfigDirForSession } from './resolveClaudeConfigDirForSession';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'happier-claude-profile-session-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveClaudeConfigDirForSession', () => {
  it('returns profile_not_provisioned for directory-only profiles', () => {
    const activeServerDir = makeRoot();
    const profileDir = join(activeServerDir, 'profiles', 'native-cli', 'claude', 'work');
    mkdirSync(profileDir, { recursive: true });

    expect(resolveClaudeConfigDirForSession({
      profileId: 'work',
      env: {},
      activeServerDir,
    })).toEqual({
      status: 'profile_not_provisioned',
      profileId: 'work',
      expectedDir: profileDir,
    });
  });

  it('returns the isolated Claude config dir for provisioned profiles', () => {
    const activeServerDir = makeRoot();
    const profileDir = join(activeServerDir, 'profiles', 'native-cli', 'claude', 'work');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, '.credentials.json'), '{"accessToken":"token"}', 'utf8');

    expect(resolveClaudeConfigDirForSession({
      profileId: 'work',
      env: {},
      activeServerDir,
    })).toEqual({ status: 'ok', configDir: profileDir });
  });

  it('falls back to the configured Claude override when no profile is selected', () => {
    const activeServerDir = makeRoot();
    const claudeConfigDir = join(activeServerDir, 'shared-claude');

    expect(resolveClaudeConfigDirForSession({
      profileId: null,
      env: { HAPPIER_CLAUDE_CONFIG_DIR: claudeConfigDir },
      activeServerDir,
    })).toEqual({ status: 'fallback', configDir: claudeConfigDir });
  });
});
