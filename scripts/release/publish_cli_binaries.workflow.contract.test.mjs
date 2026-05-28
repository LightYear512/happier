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

test('publish-cli-binaries workflow leaves full validation to the pre-release gate', async () => {
  const raw = await loadWorkflow('publish-cli-binaries.yml');

  assert.match(raw, /node scripts\/pipeline\/run\.mjs publish-cli-binaries/);
  assert.match(raw, /--run-contracts "false"/);
  assert.match(raw, /--check-installers "false"/);
});
