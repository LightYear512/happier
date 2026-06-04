import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { seedGraphifyOutFromBase } from './seed_graphify_out.mjs';

test('seedGraphifyOutFromBase copies graphify-out and rewrites worktree-local metadata', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hstack-seed-graphify-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const base = join(dir, 'base');
  const wt = join(dir, 'wt');
  await mkdir(join(base, 'graphify-out', 'cache'), { recursive: true });
  await mkdir(wt, { recursive: true });
  await writeFile(join(base, 'graphify-out', 'graph.json'), '{"nodes":[],"links":[]}\n', 'utf-8');
  await writeFile(
    join(base, 'graphify-out', 'cache', 'cached.json'),
    JSON.stringify({ nodes: [{ source_file: join(base, 'apps/ui/index.ts') }] }),
    'utf-8',
  );
  await writeFile(join(base, 'graphify-out', '.graphify_root'), `${base}\n`, 'utf-8');
  await writeFile(
    join(base, 'graphify-out', 'manifest.json'),
    JSON.stringify({
      [join(base, 'apps/cli/src/index.ts')]: {
        mtime: 1,
        ast_hash: 'abc',
        semantic_hash: 'def',
      },
    }),
    'utf-8',
  );
  await writeFile(join(base, 'graphify-out', 'cache', 'stat-index.json'), '{}\n', 'utf-8');

  const copied = [];
  const res = await seedGraphifyOutFromBase({
    baseDir: base,
    worktreeDir: wt,
    copyDir: async ({ srcDir, destDir }) => {
      copied.push({ srcDir, destDir });
      await mkdir(join(destDir, 'cache'), { recursive: true });
      for (const file of ['graph.json', '.graphify_root', 'manifest.json']) {
        await writeFile(join(destDir, file), await readFile(join(srcDir, file), 'utf-8'), 'utf-8');
      }
      for (const file of ['cached.json', 'stat-index.json']) {
        await writeFile(join(destDir, 'cache', file), await readFile(join(srcDir, 'cache', file), 'utf-8'), 'utf-8');
      }
      return { ok: true };
    },
  });

  assert.equal(res.seeded, true);
  assert.deepEqual(copied, [{ srcDir: join(base, 'graphify-out'), destDir: join(wt, 'graphify-out') }]);
  assert.equal(await readFile(join(wt, 'graphify-out', '.graphify_root'), 'utf-8'), `${wt}\n`);

  const manifest = JSON.parse(await readFile(join(wt, 'graphify-out', 'manifest.json'), 'utf-8'));
  assert.deepEqual(Object.keys(manifest), [join(wt, 'apps/cli/src/index.ts')]);
  assert.equal(manifest[join(wt, 'apps/cli/src/index.ts')].ast_hash, 'abc');

  const cached = JSON.parse(await readFile(join(wt, 'graphify-out', 'cache', 'cached.json'), 'utf-8'));
  assert.equal(cached.nodes[0].source_file, join(wt, 'apps/ui/index.ts'));
});

test('seedGraphifyOutFromBase skips when source graph is missing, locked, or destination exists', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hstack-seed-graphify-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const base = join(dir, 'base');
  const wt = join(dir, 'wt');
  await mkdir(join(base, 'graphify-out'), { recursive: true });
  await mkdir(wt, { recursive: true });

  const missing = await seedGraphifyOutFromBase({ baseDir: base, worktreeDir: wt, copyDir: async () => ({ ok: true }) });
  assert.equal(missing.seeded, false);
  assert.equal(missing.reason, 'source-graph-missing');

  await writeFile(join(base, 'graphify-out', 'graph.json'), '{}\n', 'utf-8');
  await writeFile(join(base, 'graphify-out', '.rebuild.lock'), '123\n', 'utf-8');
  const locked = await seedGraphifyOutFromBase({ baseDir: base, worktreeDir: wt, copyDir: async () => ({ ok: true }) });
  assert.equal(locked.seeded, false);
  assert.equal(locked.reason, 'source-locked');

  await rm(join(base, 'graphify-out', '.rebuild.lock'), { force: true });
  await mkdir(join(wt, 'graphify-out'), { recursive: true });
  const exists = await seedGraphifyOutFromBase({ baseDir: base, worktreeDir: wt, copyDir: async () => ({ ok: true }) });
  assert.equal(exists.seeded, false);
  assert.equal(exists.reason, 'dest-exists');
});
