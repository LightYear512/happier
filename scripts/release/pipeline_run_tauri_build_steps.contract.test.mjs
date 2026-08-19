import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function run(args, env = {}) {
  return spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'pipeline', 'run.mjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

for (const [environment, buildVersion] of [
  ['preview', '0.0.0-preview.1'],
  ['dev', '0.0.0-dev.1'],
]) {
  test(`pipeline run exposes tauri-build-updater-artifacts for ${environment} (dry-run)`, () => {
    const res = run(
      [
        'tauri-build-updater-artifacts',
        '--environment',
        environment,
        '--build-version',
        buildVersion,
        '--tauri-target',
        'x86_64-unknown-linux-gnu',
        '--ui-dir',
        'apps/ui',
        '--no-bundle',
        '--dry-run',
      ],
      {
        TAURI_SIGNING_PRIVATE_KEY: '/tmp/tauri.signing.key',
        APPLE_SIGNING_IDENTITY: 'Developer ID Application: Dummy',
      },
    );
    assert.equal(res.status, 0, `expected exit 0, got ${res.status} stderr=${res.stderr}`);
  });
}

test('pipeline run forwards tauri bundle-only finalization mode (dry-run)', () => {
  const res = run(
    [
      'tauri-build-updater-artifacts',
      '--environment',
      'dev',
      '--build-version',
      '0.0.0-dev.1',
      '--tauri-target',
      'aarch64-apple-darwin',
      '--ui-dir',
      'apps/ui',
      '--bundle-only',
      '--dry-run',
    ],
    {
      TAURI_SIGNING_PRIVATE_KEY: '/tmp/tauri.signing.key',
    },
  );
  assert.equal(res.status, 0, `expected exit 0, got ${res.status} stderr=${res.stderr}`);
});

test('pipeline run exposes tauri-notarize-macos-artifacts (dry-run)', () => {
  const res = run(
    [
      'tauri-notarize-macos-artifacts',
      '--ui-dir',
      'apps/ui',
      '--tauri-target',
      'aarch64-apple-darwin',
      '--dry-run',
    ],
  );
  assert.equal(res.status, 0, `expected exit 0, got ${res.status} stderr=${res.stderr}`);
});

test('pipeline run exposes tauri-bundle-candidate pack mode', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'happier-tauri-bundle-run-'));
  try {
    const uiDir = path.join(root, 'apps', 'ui');
    const releaseDir = path.join(uiDir, 'src-tauri', 'target', 'release');
    const binariesDir = path.join(uiDir, 'src-tauri', 'binaries');
    mkdirSync(releaseDir, { recursive: true });
    mkdirSync(binariesDir, { recursive: true });
    writeFileSync(path.join(releaseDir, 'app'), 'app');
    writeFileSync(path.join(binariesDir, 'hsetup-x86_64-unknown-linux-gnu'), 'hsetup');
    writeFileSync(path.join(binariesDir, 'hsetup-x86_64-unknown-linux-gnu.gz'), 'hsetup-gz');

    const res = run([
      'tauri-bundle-candidate',
      '--mode',
      'pack',
      '--platform-key',
      'linux-x86_64',
      '--source-sha',
      '0123456789abcdef0123456789abcdef01234567',
      '--environment',
      'dev',
      '--ui-version',
      '0.0.0',
      '--build-version',
      '0.0.0-dev.1',
      '--ui-dir',
      uiDir,
      '--out-dir',
      path.join(root, 'candidate'),
    ]);
    assert.equal(res.status, 0, `expected exit 0, got ${res.status} stderr=${res.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pipeline run exposes tauri-sign-updater-artifacts', () => {
  const res = run(['tauri-sign-updater-artifacts', '--ui-dir', 'apps/ui']);
  assert.notEqual(res.status, 0, 'signing without a signing key should fail in the delegated signer');
  assert.doesNotMatch(res.stderr, /Unsupported subcommand/);
  assert.match(res.stderr, /TAURI_SIGNING_PRIVATE_KEY is required/);
});

for (const environment of ['preview', 'dev']) {
  test(`pipeline run exposes tauri-collect-updater-artifacts for ${environment} (dry-run)`, () => {
    const res = run(
      [
        'tauri-collect-updater-artifacts',
        '--environment',
        environment,
        '--platform-key',
        'linux-x64',
        '--ui-version',
        '0.0.0',
        '--tauri-target',
        'x86_64-unknown-linux-gnu',
        '--ui-dir',
        'apps/ui',
        '--dry-run',
      ],
    );
    assert.equal(res.status, 0, `expected exit 0, got ${res.status} stderr=${res.stderr}`);
  });
}
