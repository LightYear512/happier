import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('pipeline CLI can npm-release in dry-run using env-only secrets', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
      'npm-release',
      '--channel',
      'preview',
      '--publish-cli',
      'true',
      '--publish-stack',
      'false',
      '--publish-server',
      'false',
      '--dry-run',
      '--secrets-source',
      'env',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, NPM_TOKEN: 'npm-token' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /\[pipeline\] npm release: channel=preview/);
  assert.match(out, /scripts\/pipeline\/npm\/release-packages\.mjs/);
  assert.match(out, /apps\/cli/);
});

test('pipeline CLI forwards npm package name overrides to npm-release', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
      'npm-release',
      '--channel',
      'preview',
      '--publish-cli',
      'true',
      '--publish-stack',
      'false',
      '--publish-server',
      'false',
      '--npm-package-name',
      '@lightyear512/happier-cli',
      '--dry-run',
      '--secrets-source',
      'env',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, NPM_TOKEN: 'npm-token' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /"--npm-package-name" "@lightyear512\/happier-cli"/);
  assert.match(out, /\[dry-run\] patch apps\/cli\/package\.json name -> @lightyear512\/happier-cli/);
});

test('pipeline CLI forwards npm package name overrides to preview version allocation', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
      'npm-set-preview-versions',
      '--publish-cli',
      'true',
      '--publish-stack',
      'false',
      '--publish-server',
      'false',
      '--npm-package-name',
      '@lightyear512/happier-cli',
      '--write',
      'false',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        HAPPIER_RELEASE_PUBLISHED_VERSIONS_JSON: JSON.stringify({
          github: { cli: ['cli-v0.2.7-preview.3'] },
          npm: { '@happier-dev/cli': ['0.2.7-preview.3'] },
        }),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.deepEqual(JSON.parse(out), { cli: '0.2.7-preview.3' });
});

test('npm-release local preview suffix starts at the first unpublished rolling version when no versions exist', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
      'npm-release',
      '--channel',
      'preview',
      '--publish-cli',
      'true',
      '--publish-stack',
      'true',
      '--publish-server',
      'false',
      '--dry-run',
      '--secrets-source',
      'env',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NPM_TOKEN: 'npm-token',
        GITHUB_RUN_NUMBER: '',
        GITHUB_RUN_ATTEMPT: '',
        HAPPIER_RELEASE_PUBLISHED_VERSIONS_JSON: JSON.stringify({ github: {}, npm: {} }),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.doesNotMatch(out, /-preview\.0\.1\b/, 'rolling preview allocation must never publish run zero');
  assert.match(out, /-preview\.1\b/, 'first rolling preview version should start from the published-version allocator');
});
