import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');

test('server runtime uses a static psl import so Bun compile includes it in the binary', async () => {
  const raw = await readFile(
    join(repoRoot, 'apps', 'server', 'sources', 'app', 'devPreview', 'previewHostNamespace.ts'),
    'utf8',
  );

  assert.match(raw, /import\s+psl\s+from\s+['"]psl['"]/);
  assert.doesNotMatch(raw, /createRequire\s*\(\s*import\.meta\.url\s*\)/);
  assert.doesNotMatch(raw, /require\s*\(\s*['"]psl['"]\s*\)/);
});
