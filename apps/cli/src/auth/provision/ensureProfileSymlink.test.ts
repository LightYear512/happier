import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureProfileSymlink } from './ensureProfileSymlink';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'happier-profile-symlink-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ensureProfileSymlink', () => {
  it('creates missing directory targets before linking', () => {
    const root = makeRoot();
    const target = join(root, 'global', 'projects');
    const linkPath = join(root, 'profile', 'projects');

    ensureProfileSymlink({ target, linkPath, targetKind: 'directory' });

    expect(statSync(target).isDirectory()).toBe(true);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
  });

  it('does not create missing file targets as directories', () => {
    const root = makeRoot();
    const target = join(root, 'global', 'config.toml');
    const linkPath = join(root, 'profile', 'config.toml');

    ensureProfileSymlink({ target, linkPath, targetKind: 'file' });
    ensureProfileSymlink({ target, linkPath, targetKind: 'file' });

    expect(existsSync(target)).toBe(false);
    expect(existsSync(dirname(target))).toBe(false);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
  });

  it('can materialize a missing file target with explicit content', () => {
    const root = makeRoot();
    const target = join(root, 'global', 'settings.json');
    const linkPath = join(root, 'profile', 'settings.json');

    ensureProfileSymlink({ target, linkPath, targetKind: 'file', createMissingFileContent: '{}' });

    expect(statSync(target).isFile()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('{}');
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
  });
});
