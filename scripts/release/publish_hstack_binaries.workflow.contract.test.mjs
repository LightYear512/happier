import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function loadWorkflow(name) {
  return readFile(join(repoRoot, '.github', 'workflows', name), 'utf8');
}

test('publish-hstack-binaries falls back to GITHUB_TOKEN when release bot secrets are absent', async () => {
  const raw = await loadWorkflow('publish-hstack-binaries.yml');

  assert.match(raw, /name:\s*PUBLISH\s+—\s+HStack Binaries/i);
  assert.match(raw, /node scripts\/pipeline\/run\.mjs publish-hstack-binaries/);
  assert.match(
    raw,
    /RELEASE_BOT_APP_ID:\s*\$\{\{\s*secrets\.RELEASE_BOT_APP_ID\s*\}\}[\s\S]*?RELEASE_BOT_PRIVATE_KEY:\s*\$\{\{\s*secrets\.RELEASE_BOT_PRIVATE_KEY\s*\}\}/,
    'publish job should expose release bot secrets through env for conditional token creation',
  );
  assert.match(
    raw,
    /Create GitHub App token[\s\S]*?if:\s*\$\{\{\s*env\.RELEASE_BOT_APP_ID != '' && env\.RELEASE_BOT_PRIVATE_KEY != ''\s*\}\}/,
    'release bot token creation should be skipped when the fork has no app secrets',
  );
  assert.match(
    raw,
    /token:\s*\$\{\{\s*\(?steps\.app_token\.outputs\.token != '' && steps\.app_token\.outputs\.token\)? \|\| github\.token\s*\}\}/,
    'source checkout should fall back to GITHUB_TOKEN in forks',
  );
  assert.match(
    raw,
    /GH_TOKEN:\s*\$\{\{\s*\(?steps\.app_token\.outputs\.token != '' && steps\.app_token\.outputs\.token\)? \|\| github\.token\s*\}\}/,
    'release publishing should fall back to GITHUB_TOKEN in forks',
  );
});

test('publish-hstack-binaries does not run global release contracts inside the publish lane', async () => {
  const raw = await loadWorkflow('publish-hstack-binaries.yml');

  assert.match(raw, /--run-contracts "false"/);
  assert.match(raw, /--check-installers "false"/);
});
