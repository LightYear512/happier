import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

test('stress tests workflow keeps scheduled config static so nightly runs create jobs', async () => {
  const raw = await readFile(join(repoRoot, '.github', 'workflows', 'stress-tests.yml'), 'utf8');

  assert.match(raw, /\bstress:\n[\s\S]*?name:\s*Stress \(repeat\/chaos\)/);
  assert.doesNotMatch(raw, /\bstress-scheduled:/);
  assert.doesNotMatch(raw, /\bstress-dispatch:/);
  assert.doesNotMatch(raw, /\buses:\s*\.\/\.github\/workflows\/tests\.yml/);
  assert.match(raw, /HAPPIER_E2E_REPEAT:\s*\$\{\{\s*github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.event\.inputs\.repeat\s*\|\|\s*'10'\s*\}\}/);
  assert.match(raw, /HAPPIER_E2E_SEED:\s*\$\{\{\s*github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.event\.inputs\.seed\s*\|\|\s*''\s*\}\}/);
  assert.match(raw, /run:\s*yarn test:stress/);
});
