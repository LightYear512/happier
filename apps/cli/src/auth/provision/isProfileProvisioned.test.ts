import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { isProfileProvisioned } from './isProfileProvisioned';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'happier-profile-provisioned-'));
  roots.push(root);
  return root;
}

function createProfileDir(activeServerDir: string, backendId: 'claude' | 'codex', profileId: string): string {
  const profileDir = join(activeServerDir, 'profiles', 'native-cli', backendId, profileId);
  mkdirSync(profileDir, { recursive: true });
  return profileDir;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('isProfileProvisioned', () => {
  it('does not treat a directory-only Claude profile as provisioned', () => {
    const activeServerDir = makeRoot();
    createProfileDir(activeServerDir, 'claude', 'work');

    expect(isProfileProvisioned('work', 'claude', activeServerDir)).toBe(false);
  });

  it('accepts either Claude credentials file layout as provisioned', () => {
    const activeServerDir = makeRoot();
    const legacyProfileDir = createProfileDir(activeServerDir, 'claude', 'legacy');
    const currentProfileDir = createProfileDir(activeServerDir, 'claude', 'current');
    writeFileSync(join(legacyProfileDir, '.credentials.json'), '{"accessToken":"token"}', 'utf8');
    writeFileSync(join(currentProfileDir, '.claude.json'), '{"accessToken":"token"}', 'utf8');

    expect(isProfileProvisioned('legacy', 'claude', activeServerDir)).toBe(true);
    expect(isProfileProvisioned('current', 'claude', activeServerDir)).toBe(true);
  });

  it('requires Codex auth.json for Codex profiles', () => {
    const activeServerDir = makeRoot();
    createProfileDir(activeServerDir, 'codex', 'empty');
    const provisionedProfileDir = createProfileDir(activeServerDir, 'codex', 'work');
    writeFileSync(join(provisionedProfileDir, 'auth.json'), '{"tokens":{"access_token":"token"}}', 'utf8');

    expect(isProfileProvisioned('empty', 'codex', activeServerDir)).toBe(false);
    expect(isProfileProvisioned('work', 'codex', activeServerDir)).toBe(true);
  });

  it('does not resolve profile ids outside the backend profile directory', () => {
    const activeServerDir = makeRoot();
    const escapedProfileDir = join(activeServerDir, 'profiles', 'escaped');
    mkdirSync(escapedProfileDir, { recursive: true });
    writeFileSync(join(escapedProfileDir, 'auth.json'), '{"tokens":{"access_token":"token"}}', 'utf8');

    expect(isProfileProvisioned('../escaped', 'codex', activeServerDir)).toBe(false);
  });
});
