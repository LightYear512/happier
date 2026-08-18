import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const emptyPublishedVersionsFixture = JSON.stringify({ github: {}, npm: {} });

test('pipeline npm release script supports pack-only mode (no publish) in dry-run', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'npm', 'release-packages.mjs'),
      '--channel',
      'preview',
      '--publish-cli',
      'true',
      '--publish-stack',
      'false',
      '--publish-server',
      'false',
      '--mode',
      'pack',
      '--dry-run',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        HAPPIER_RELEASE_PUBLISHED_VERSIONS_JSON: emptyPublishedVersionsFixture,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /apps\/cli/);
  assert.doesNotMatch(out, /publish-tarball\.mjs/);
});

test('pipeline npm release script can rewrite the published npm package name in dry-run', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'npm', 'release-packages.mjs'),
      '--channel',
      'preview',
      '--publish-cli',
      'true',
      '--publish-stack',
      'false',
      '--publish-server',
      'false',
      '--mode',
      'pack',
      '--npm-package-name',
      '@lightyear512/happier-cli',
      '--dry-run',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        GITHUB_REPOSITORY: 'LightYear512/happier',
        HAPPIER_RELEASE_PUBLISHED_VERSIONS_JSON: emptyPublishedVersionsFixture,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /\[dry-run\] patch apps\/cli\/package\.json name -> @lightyear512\/happier-cli/);
  assert.match(
    out,
    /\[dry-run\] patch apps\/cli\/package\.json repository -> https:\/\/github\.com\/LightYear512\/happier/,
  );
  assert.match(out, /\[dry-run\] patch apps\/cli\/package\.json homepage -> https:\/\/github\.com\/LightYear512\/happier/);
  assert.match(out, /\[dry-run\] patch apps\/cli\/package\.json bugs -> https:\/\/github\.com\/LightYear512\/happier\/issues/);
  assert.match(out, /\[dry-run\] patch apps\/cli\/README\.md package references -> @lightyear512\/happier-cli/);
});

test('pipeline npm release script rejects package name rewrite for multi-package publishes', async () => {
  assert.throws(
    () => execFileSync(
      process.execPath,
      [
        resolve(repoRoot, 'scripts', 'pipeline', 'npm', 'release-packages.mjs'),
        '--channel',
        'preview',
        '--publish-cli',
        'true',
        '--publish-stack',
        'true',
        '--publish-server',
        'false',
        '--mode',
        'pack',
        '--npm-package-name',
        '@lightyear512/happier-cli',
        '--dry-run',
      ],
      {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    ),
    /--npm-package-name can only be used when publishing the CLI package by itself/,
  );
});
