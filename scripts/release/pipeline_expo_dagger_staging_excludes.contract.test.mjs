import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stageRepoForDagger } from '../pipeline/expo/stage-repo-for-dagger.mjs';

test('stageRepoForDagger excludes only root output/ (not nested output/ folders)', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'happier-stage-repo-root-'));

  const nested = path.join(repoRoot, 'apps', 'ui', 'sources', 'voice', 'output', 'speakAssistantText.ts');
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, 'export const speakAssistantText = () => "ok";\n', 'utf8');

  const rootOutput = path.join(repoRoot, 'output', 'should-not-stage.txt');
  fs.mkdirSync(path.dirname(rootOutput), { recursive: true });
  fs.writeFileSync(rootOutput, 'nope\n', 'utf8');

  const { stagedRepoDir, cleanup } = stageRepoForDagger({
    repoRoot,
    files: ['apps/ui/sources/voice/output/speakAssistantText.ts', 'output/should-not-stage.txt'],
  });

  assert.ok(
    fs.existsSync(path.join(stagedRepoDir, 'apps', 'ui', 'sources', 'voice', 'output', 'speakAssistantText.ts')),
    'expected nested apps/ui/**/output/* to be staged',
  );
  assert.equal(
    fs.existsSync(path.join(stagedRepoDir, 'output', 'should-not-stage.txt')),
    false,
    'expected root output/ to be excluded',
  );

  cleanup();
});

test('stageRepoForDagger excludes checked-in CLI tool archives from Dagger sync', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'happier-stage-repo-root-'));

  const archive = path.join(repoRoot, 'apps', 'cli', 'tools', 'archives', 'difftastic-x64-linux.tar.gz');
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(archive, 'large archive placeholder\n', 'utf8');

  const packageJson = path.join(repoRoot, 'apps', 'cli', 'package.json');
  fs.mkdirSync(path.dirname(packageJson), { recursive: true });
  fs.writeFileSync(packageJson, '{"name":"@happier-dev/cli"}\n', 'utf8');

  const { stagedRepoDir, cleanup } = stageRepoForDagger({
    repoRoot,
    files: ['apps/cli/tools/archives/difftastic-x64-linux.tar.gz', 'apps/cli/package.json'],
  });

  assert.equal(
    fs.existsSync(path.join(stagedRepoDir, 'apps', 'cli', 'tools', 'archives', 'difftastic-x64-linux.tar.gz')),
    false,
    'expected CLI tool archives to be excluded from Dagger staging',
  );
  assert.ok(
    fs.existsSync(path.join(stagedRepoDir, 'apps', 'cli', 'package.json')),
    'expected normal CLI files to remain stageable',
  );

  cleanup();
});
