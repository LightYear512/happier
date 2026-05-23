import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveCodexHomeForSession } from './resolveCodexHomeForSession';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'happier-codex-profile-session-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveCodexHomeForSession', () => {
  it('returns profile_not_provisioned for directory-only profiles', () => {
    const activeServerDir = makeRoot();
    const profileDir = join(activeServerDir, 'profiles', 'native-cli', 'codex', 'work');
    mkdirSync(profileDir, { recursive: true });

    expect(resolveCodexHomeForSession({
      profileId: 'work',
      env: {},
      activeServerDir,
    })).toEqual({
      status: 'profile_not_provisioned',
      profileId: 'work',
      expectedDir: profileDir,
    });
  });

  it('returns the isolated Codex home for provisioned profiles', () => {
    const activeServerDir = makeRoot();
    const profileDir = join(activeServerDir, 'profiles', 'native-cli', 'codex', 'work');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'auth.json'), '{"tokens":{"access_token":"token"}}', 'utf8');

    expect(resolveCodexHomeForSession({
      profileId: 'work',
      env: {},
      activeServerDir,
    })).toEqual({ status: 'ok', codexHome: profileDir });
  });

  it('falls back to the configured Codex home when no profile is selected', () => {
    const activeServerDir = makeRoot();
    const codexHome = join(activeServerDir, 'shared-codex');

    expect(resolveCodexHomeForSession({
      profileId: '',
      env: { CODEX_HOME: codexHome },
      activeServerDir,
    })).toEqual({ status: 'fallback', codexHome });
  });
});
