import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { pathExists } from '../fs/fs.mjs';
import { reflinkCopyDir } from './reflink_copy_dir.mjs';

function isFalseyEnv(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s === '0' || s === 'false' || s === 'no' || s === 'off';
}

function rewritePathPrefix(value, fromRoot, toRoot) {
  if (typeof value !== 'string' || !value.startsWith(fromRoot)) {
    return value;
  }
  const next = toRoot + value.slice(fromRoot.length);
  return next;
}

function rewriteJsonPathPrefixes(value, fromRoot, toRoot) {
  if (typeof value === 'string') {
    return rewritePathPrefix(value, fromRoot, toRoot);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonPathPrefixes(item, fromRoot, toRoot));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const rewritten = {};
  for (const [key, child] of Object.entries(value)) {
    rewritten[rewritePathPrefix(key, fromRoot, toRoot)] = rewriteJsonPathPrefixes(child, fromRoot, toRoot);
  }
  return rewritten;
}

async function rewriteGraphifyRoot({ graphifyOutDir, worktreeDir }) {
  await writeFile(join(graphifyOutDir, '.graphify_root'), `${worktreeDir}\n`, 'utf-8');
}

async function rewriteManifest({ graphifyOutDir, baseDir, worktreeDir }) {
  const manifestPath = join(graphifyOutDir, 'manifest.json');
  if (!(await pathExists(manifestPath))) {
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf-8'));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }

  const rewritten = rewriteJsonPathPrefixes(parsed, baseDir, worktreeDir);
  await writeFile(manifestPath, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf-8');
  return true;
}

async function rewriteJsonFilePathPrefixes({ filePath, baseDir, worktreeDir }) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return false;
  }
  const rewritten = rewriteJsonPathPrefixes(parsed, baseDir, worktreeDir);
  await writeFile(filePath, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf-8');
  return true;
}

async function rewriteJsonTreePathPrefixes({ dir, baseDir, worktreeDir }) {
  let rewrittenCount = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewrittenCount += await rewriteJsonTreePathPrefixes({ dir: child, baseDir, worktreeDir });
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    if (await rewriteJsonFilePathPrefixes({ filePath: child, baseDir, worktreeDir })) {
      rewrittenCount += 1;
    }
  }
  return rewrittenCount;
}

export async function seedGraphifyOutFromBase({
  baseDir,
  worktreeDir,
  env = process.env,
  copyDir = reflinkCopyDir,
} = {}) {
  if (isFalseyEnv(env.HAPPIER_STACK_WT_SEED_GRAPHIFY_OUT)) {
    return { ok: true, seeded: false, reason: 'disabled' };
  }

  const base = String(baseDir ?? '').trim();
  const wt = String(worktreeDir ?? '').trim();
  if (!base || !wt) {
    return { ok: true, seeded: false, reason: 'missing-path' };
  }

  const source = join(base, 'graphify-out');
  const dest = join(wt, 'graphify-out');
  if (!(await pathExists(join(source, 'graph.json')))) {
    return { ok: true, seeded: false, reason: 'source-graph-missing' };
  }
  if (await pathExists(join(source, '.rebuild.lock'))) {
    return { ok: true, seeded: false, reason: 'source-locked' };
  }
  if (await pathExists(dest)) {
    return { ok: true, seeded: false, reason: 'dest-exists' };
  }

  await mkdir(wt, { recursive: true });
  const copied = await copyDir({ srcDir: source, destDir: dest });
  if (!copied?.ok) {
    return { ok: true, seeded: false, reason: copied?.reason ?? 'copy-failed', error: copied?.error ?? null };
  }

  await rewriteGraphifyRoot({ graphifyOutDir: dest, worktreeDir: wt });
  const rewrittenJsonFiles = await rewriteJsonTreePathPrefixes({ dir: dest, baseDir: base, worktreeDir: wt });
  const manifestRewritten = await rewriteManifest({ graphifyOutDir: dest, baseDir: base, worktreeDir: wt });

  return {
    ok: true,
    seeded: true,
    reason: 'seeded',
    manifestRewritten,
    rewrittenJsonFiles,
  };
}
