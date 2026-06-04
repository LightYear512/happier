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

test('publish-server-runtime workflow exists and does not manage deploy branches', async () => {
  const raw = await loadWorkflow('publish-server-runtime.yml');

  assert.match(raw, /name:\s*PUBLISH\s+—\s+Server Runtime/i);
  assert.match(raw, /workflow_dispatch:/);
  assert.match(raw, /workflow_call:/);

  assert.doesNotMatch(raw, /deploy\//, 'server runtime publish must not push deploy/* branches');
  assert.doesNotMatch(raw, /Promote source ref to deploy branch/i);
});

test('publish-server-runtime workflow publishes rolling server-preview tag via release bot', async () => {
  const raw = await loadWorkflow('publish-server-runtime.yml');

  assert.match(raw, /actions\/create-github-app-token@v1/);
  assert.match(raw, /RELEASE_BOT_APP_ID/);
  assert.match(raw, /RELEASE_BOT_PRIVATE_KEY/);

  assert.match(raw, /node scripts\/pipeline\/run\.mjs publish-server-runtime/);
});

test('publish-server-runtime falls back to GITHUB_TOKEN when release bot secrets are absent', async () => {
  const raw = await loadWorkflow('publish-server-runtime.yml');

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

test('publish-server-runtime does not run global release contracts inside the publish lane', async () => {
  const raw = await loadWorkflow('publish-server-runtime.yml');

  assert.match(raw, /--run-contracts "false"/);
  assert.match(raw, /--check-installers "false"/);
});

test('publish-server-runtime supports dev and resolves auto source_ref from the selected channel', async () => {
  const raw = await loadWorkflow('publish-server-runtime.yml');

  assert.match(raw, /options:[\s\S]*?- preview[\s\S]*?- dev[\s\S]*?- stable/);
  assert.match(raw, /node scripts\/pipeline\/release\/resolve-public-release-channel-meta\.mjs/);
  assert.match(raw, /id:\s*channel_meta/);
  assert.match(raw, /ref:\s*\$\{\{\s*steps\.channel_meta\.outputs\.source_ref\s*\}\}/);
  assert.doesNotMatch(
    raw,
    /if \[ "\$src" = "auto" \]; then[\s\S]*?src="dev"[\s\S]*?src="preview"[\s\S]*?src="main"/,
  );
});

test('publish-server-runtime embeds build feature policy defaults by channel', async () => {
  const raw = await loadWorkflow('publish-server-runtime.yml');

  assert.match(
    raw,
    /HAPPIER_EMBEDDED_POLICY_ENV:\s*\$\{\{\s*steps\.channel_meta\.outputs\.embedded_policy_env\s*\}\}/,
    'server runtime publishing should set HAPPIER_EMBEDDED_POLICY_ENV to production for stable artifacts',
  );
  assert.doesNotMatch(raw, /inputs\.channel\s*==\s*'publicdev'/);
});
