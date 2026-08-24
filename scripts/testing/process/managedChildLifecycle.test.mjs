import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runManagedChildCommand } from './managedChildLifecycle.mjs';

test('runManagedChildCommand returns a timeout result and terminates the child', async () => {
  const result = await runManagedChildCommand({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    spawnOptions: {
      stdio: 'ignore',
    },
    timeoutMs: 50,
    cleanupPollMs: 10,
    timeoutCleanupGraceMs: 10,
    exitCleanupGraceMs: 10,
  });

  assert.equal(result.ok, true);
  assert.equal(result.timedOut, true);
  assert.equal(result.code, 124);
  assert.equal(result.signal, null);
});

test('runManagedChildCommand does not mark a quick child as timed out', async () => {
  const result = await runManagedChildCommand({
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    spawnOptions: {
      stdio: 'ignore',
    },
    timeoutMs: 5_000,
    cleanupPollMs: 10,
    exitCleanupGraceMs: 10,
  });

  assert.equal(result.ok, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.code, 0);
});
