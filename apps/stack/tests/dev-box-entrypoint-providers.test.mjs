import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildStackHarnessEnv, writeFakeBin } from '../scripts/testkit/core/fake_bin_harness.mjs';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

test('dev-box entrypoint installs provider CLIs via happier when HAPPIER_PROVIDER_CLIS is set', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'happier-dev-box-entrypoint-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));

  const logPath = join(tmp, 'happier.log');
  writeFileSync(logPath, '', 'utf-8');

  const { binDir } = writeFakeBin({
    root: tmp,
    name: 'happier',
    content: `#!/bin/sh
set -eu
echo "$@" >> "${logPath}"
exit 0
`,
  });

  const entrypoint = join(repoRoot, 'docker', 'dev-box', 'entrypoint.sh');
  const res = spawnSync('sh', [entrypoint, 'sh', '-lc', 'echo ok'], {
    env: buildStackHarnessEnv({
      binDirs: [binDir],
      extraEnv: { HAPPIER_PROVIDER_CLIS: 'codex, Gemini ' },
    }),
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (res.error) throw res.error;
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout ?? '', /ok/);

  const log = readFileSync(logPath, 'utf-8');
  assert.match(log, /^install provider codex$/m);
  assert.match(log, /^install provider gemini$/m);
  assert.doesNotMatch(log, /providers install/);
});

test('dev-box entrypoint starts local server when HAPPIER_DEV_BOX_AUTOSTART_SERVER is enabled', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'happier-dev-box-entrypoint-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));

  const workspaceDir = join(tmp, 'workspace', 'happier');
  mkdirSync(workspaceDir, { recursive: true });

  const logPath = join(tmp, 'hstack.log');
  writeFileSync(logPath, '', 'utf-8');

  const { binDir } = writeFakeBin({
    root: tmp,
    name: 'hstack',
    content: `#!/bin/sh
set -eu
printf 'cwd=%s\\n' "$(pwd)" >> "${logPath}"
printf 'url=%s\\n' "$\{HAPPIER_SERVER_URL:-}" >> "${logPath}"
printf 'port=%s\\n' "$\{HAPPIER_STACK_SERVER_PORT:-}" >> "${logPath}"
echo "$@" >> "${logPath}"
exit 0
`,
  });

  const entrypoint = join(repoRoot, 'docker', 'dev-box', 'entrypoint.sh');
  const res = spawnSync('sh', [entrypoint, 'sh', '-lc', 'echo "$HAPPIER_SERVER_URL"'], {
    env: buildStackHarnessEnv({
      binDirs: [binDir],
      extraEnv: {
        HAPPIER_DEV_BOX_AUTOSTART_SERVER: '1',
        HAPPIER_DEV_BOX_WORKSPACE: workspaceDir,
        HAPPIER_SERVER_URL: '',
        HAPPIER_STACK_SERVER_PORT: '',
      },
    }),
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (res.error) throw res.error;
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout ?? '', /http:\/\/127\.0\.0\.1:4101/);

  const log = readFileSync(logPath, 'utf-8');
  assert.match(log, new RegExp(`cwd=${workspaceDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(log, /url=http:\/\/127\.0\.0\.1:4101/);
  assert.match(log, /port=4101/);
  assert.match(log, /start --server-flavor=light --bind=loopback --restart/);
});
