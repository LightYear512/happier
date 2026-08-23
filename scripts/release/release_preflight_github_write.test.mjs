import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const scriptPath = resolve(repoRoot, 'scripts/pipeline/github/release-preflight-github-write.mjs');

test('release GitHub write preflight creates and deletes a temporary tag through gh api', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'happier-release-preflight-'));
  const binDir = join(tmp, 'bin');
  const logPath = join(tmp, 'gh-args.jsonl');
  writeFileSync(join(tmp, 'placeholder'), '');
  mkdirSync(binDir);
  const ghPath = join(binDir, 'gh');
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');
`,
  );
  chmodSync(ghPath, 0o755);

  execFileSync(
    process.execPath,
    [
      scriptPath,
      '--repository',
      'LightYear512/happier',
      '--target-sha',
      '0123456789abcdef0123456789abcdef01234567',
      '--tag',
      'release-preflight-dev-123-1',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        GH_TOKEN: 'test-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const calls = readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(calls, [
    [
      'api',
      '-X',
      'POST',
      '-f',
      'ref=refs/tags/release-preflight-dev-123-1',
      '-f',
      'sha=0123456789abcdef0123456789abcdef01234567',
      'repos/LightYear512/happier/git/refs',
    ],
    [
      'api',
      '-X',
      'DELETE',
      'repos/LightYear512/happier/git/refs/tags/release-preflight-dev-123-1',
    ],
  ]);
});
