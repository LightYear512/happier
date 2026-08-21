#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveSignalExitCode, runManagedChildCommand } from '../../../scripts/testing/process/managedChildLifecycle.mjs';
import { resolveMaxOldSpaceSizeMb, upsertMaxOldSpaceSize } from './withNodeHeapLimit.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(scriptDir, '..');
const vitestBin = resolve(
  cliRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
);

function parsePositiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isExcludedTestFile(filePath) {
  return (
    filePath.endsWith('.slow.test.ts')
    || filePath.endsWith('.integration.test.ts')
    || filePath.endsWith('.real.integration.test.ts')
    || filePath.endsWith('.integration.spec.ts')
    || filePath.endsWith('.e2e.test.ts')
  );
}

function isIsolatedTestFile(filePath) {
  return filePath.startsWith('src/api/session/mutations/');
}

function collectTestFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.test.ts')) continue;
      const rel = relative(cliRoot, abs).replaceAll('\\', '/');
      if (isExcludedTestFile(rel)) continue;
      out.push(rel);
    }
  }
  return out.sort();
}

function chunk(files, size) {
  const chunks = [];
  let current = [];
  for (const file of files) {
    if (isIsolatedTestFile(file)) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
      }
      chunks.push([file]);
      continue;
    }
    current.push(file);
    if (current.length >= size) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

async function runBatch({ configPath, files, batchIndex, batchCount, nodeOptions }) {
  // eslint-disable-next-line no-console
  console.log(`[vitest] batch ${batchIndex}/${batchCount} (${files.length} files)`);
  const result = await runManagedChildCommand({
    command: vitestBin,
    args: ['run', '--config', configPath, '--maxWorkers=1', ...files],
    spawnOptions: {
      cwd: cliRoot,
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
      },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
    cleanupPollMs: 25,
    signalCleanupGraceMs: 0,
    exitCleanupGraceMs: 1_000,
    parentWatchdogPollMs: Number.parseInt(process.env.HAPPIER_TEST_PARENT_WATCHDOG_MS ?? '1000', 10),
  });
  if (!result.ok) throw result.error;
  if (result.signal) {
    process.exit(resolveSignalExitCode(result.signal));
    return false;
  }
  if (result.code && result.code !== 0) {
    process.exit(result.code);
    return false;
  }
  return true;
}

async function main() {
  const configPath = process.argv.includes('--config')
    ? process.argv[process.argv.indexOf('--config') + 1]
    : 'vitest.config.ts';
  const batchSize = parsePositiveInt(process.env.HAPPIER_CLI_VITEST_BATCH_SIZE, 5);
  const files = [
    ...collectTestFiles(resolve(cliRoot, 'src')),
    ...collectTestFiles(resolve(cliRoot, 'scripts')),
  ];
  const batchLimit = parsePositiveInt(process.env.HAPPIER_CLI_VITEST_BATCH_LIMIT, 0);
  const allBatches = chunk(files, batchSize);
  const batches = batchLimit > 0 ? allBatches.slice(0, batchLimit) : allBatches;
  const nodeOptions = upsertMaxOldSpaceSize(process.env.NODE_OPTIONS, resolveMaxOldSpaceSizeMb(process.env));

  // eslint-disable-next-line no-console
  console.log(`[vitest] ${files.length} files across ${allBatches.length} batches (batchSize=${batchSize})`);
  for (let index = 0; index < batches.length; index += 1) {
    const shouldContinue = await runBatch({
      configPath,
      files: batches[index],
      batchIndex: index + 1,
      batchCount: batches.length,
      nodeOptions,
    });
    if (!shouldContinue) return;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
