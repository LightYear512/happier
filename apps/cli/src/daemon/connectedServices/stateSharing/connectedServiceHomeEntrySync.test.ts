import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { moveConnectedServiceHomeEntryAside } from './connectedServiceHomeEntrySync';

describe('moveConnectedServiceHomeEntryAside', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries with a disambiguated suffix when a same-millisecond local directory already exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-home-entry-aside-'));
    const entryPath = join(root, 'projects');
    const timestamp = 1_787_628_394_815;

    try {
      vi.spyOn(Date, 'now').mockReturnValue(timestamp);
      await mkdir(entryPath, { recursive: true });
      await writeFile(join(entryPath, 'session.jsonl'), '{}\n');
      await mkdir(`${entryPath}.local-${timestamp}`, { recursive: true });
      await writeFile(join(`${entryPath}.local-${timestamp}`, 'provider-created.txt'), 'preserve me');

      await moveConnectedServiceHomeEntryAside(entryPath);

      await expect(readdir(entryPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readdir(`${entryPath}.local-${timestamp}`)).resolves.toEqual(['provider-created.txt']);
      await expect(readdir(`${entryPath}.local-${timestamp}-1`)).resolves.toEqual(['session.jsonl']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
