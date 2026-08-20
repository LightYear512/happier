import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

const repoRoot = resolve(new URL('../..', import.meta.url).pathname);

test('light sqlite daemon e2e disables host-based session dev preview relay', () => {
  const workflow = YAML.parse(readFileSync(resolve(repoRoot, '.github/workflows/tests.yml'), 'utf8'));
  const job = workflow.jobs?.['cli-daemon-e2e'];

  assert.equal(job?.env?.HAPPIER_SERVER_URL, 'http://localhost:3005');
  assert.equal(job?.env?.HAPPIER_WEBAPP_URL, 'http://localhost:3005');
  assert.equal(job?.env?.HAPPIER_FEATURE_SESSIONS_DEV_PREVIEW_RELAY__ENABLED, '0');
});
