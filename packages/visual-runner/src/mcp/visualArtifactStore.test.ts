import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createVisualArtifactStore } from './visualArtifactStore.js';

describe('visualArtifactStore', () => {
  it('records artifacts with stable refs and removes expired files before writing the next artifact', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'visual-artifact-store-'));
    const now = new Date('2026-05-12T00:00:00.000Z');
    try {
      const store = createVisualArtifactStore({
        cwd: tmp,
        sessionId: 'visual-session-1',
        ttlMs: 1_000,
        maxBytes: 10_000,
        now: () => now,
        generateArtifactId: () => 'artifact-1',
      });

      const oldPath = join(tmp, '.happier', 'visual-runner', 'visual-session-1', 'old.png');
      await mkdir(store.artifactDir, { recursive: true });
      await writeFile(oldPath, Buffer.from('old'));
      await utimes(oldPath, new Date('2026-05-11T23:59:58.000Z'), new Date('2026-05-11T23:59:58.000Z'));
      await store.writeArtifact({
        kind: 'screenshot',
        mimeType: 'image/png',
        extension: 'png',
        write: async (path) => writeFile(path, Buffer.from('new-artifact')),
      });

      await expect(readFile(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('enforces session artifact quota by deleting the oldest files', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'visual-artifact-store-'));
    let counter = 0;
    try {
      const store = createVisualArtifactStore({
        cwd: tmp,
        sessionId: 'visual-session-1',
        ttlMs: 60_000,
        maxBytes: 12,
        now: () => new Date(`2026-05-12T00:00:0${counter}.000Z`),
        generateArtifactId: () => `artifact-${counter += 1}`,
      });

      const first = await store.writeArtifact({
        kind: 'screenshot',
        mimeType: 'image/png',
        extension: 'png',
        write: async (path) => writeFile(path, Buffer.from('12345678')),
      });
      const second = await store.writeArtifact({
        kind: 'trace',
        mimeType: 'application/zip',
        extension: 'zip',
        write: async (path) => writeFile(path, Buffer.from('abcdefghi')),
      });

      await expect(readFile(first.artifactPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(second.artifactPath, 'utf8')).toBe('abcdefghi');
      expect(second.artifactRef).toMatchObject({
        id: 'artifact-2',
        kind: 'trace',
        mimeType: 'application/zip',
        sizeBytes: 9,
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
