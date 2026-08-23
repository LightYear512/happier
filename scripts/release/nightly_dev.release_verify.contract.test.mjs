import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('nightly-dev workflow runs reusable release verification against the dev channel', async () => {
  const raw = await readFile(join(repoRoot, '.github', 'workflows', 'nightly-dev.yml'), 'utf8');

  assert.match(
    raw,
    /cron:\s*"7 14 \* \* \*"/,
    'nightly-dev should run at 22:07 Asia/Shanghai (14:07 UTC)',
  );

  assert.match(
    raw,
    /release_verify:[\s\S]*?needs:\s*\[prepare_release_candidate, cli, hstack, server_runtime, ui_web, resolve_validation_risk\][\s\S]*?uses:\s*\.\/\.github\/workflows\/release-verify\.yml/,
    'nightly-dev should verify exact immutable candidates before promotion',
  );
  assert.match(
    raw,
    /release_verify:[\s\S]*?channel:\s*dev/,
    'nightly-dev should validate the dev channel through release-verify',
  );
  assert.match(
    raw,
    /release_verify:[\s\S]*?candidate_source_sha:\s*\${{\s*needs\.prepare_release_candidate\.outputs\.source_sha\s*}}/,
    'nightly-dev should bind release verification to the prepared candidate SHA',
  );
  assert.match(
    raw,
    /release_verify:[\s\S]*?candidate_cli_version:\s*\${{\s*needs\.cli\.outputs\.version\s*}}/,
    'nightly-dev should verify the CLI candidate version produced by the immutable publish lane',
  );
  assert.match(
    raw,
    /release_verify:[\s\S]*?candidate_server_version:\s*\${{\s*needs\.server_runtime\.outputs\.version\s*}}/,
    'nightly-dev should verify the server candidate version produced by the immutable publish lane',
  );
  assert.match(
    raw,
    /permissions:\s*[\s\S]*?actions:\s*read/,
    'nightly-dev should grant actions: read because the reusable release-verify workflow requires it',
  );

  assert.match(
    raw,
    /promote_cli:[\s\S]*?needs:\s*\[prepare_release_candidate, cli, promote_hstack\][\s\S]*?retry_version:\s*\${{\s*needs\.cli\.outputs\.version\s*}}/,
    'nightly-dev should promote the verified CLI candidate instead of rebuilding it',
  );
  for (const jobName of ['promote_server', 'promote_hstack', 'promote_cli', 'promote_ui_web']) {
    assert.match(
      raw,
      new RegExp(`${jobName}:[\\s\\S]*?permissions:\\n\\s+contents:\\s*write[\\s\\S]*?uses:\\s*\\.\\/\\.github\\/workflows\\/`),
      `${jobName} must grant contents: write to reusable rolling promotion so fork GITHUB_TOKEN fallback can create backup tags`,
    );
  }
  assert.match(
    raw,
    /docker:[\s\S]*?needs:\s*\[prepare_release_candidate, cli, server_runtime, promote_ui_web\][\s\S]*?server_version:\s*\${{\s*needs\.server_runtime\.outputs\.version\s*}}[\s\S]*?cli_version:\s*\${{\s*needs\.cli\.outputs\.version\s*}}/,
    'nightly-dev should publish Docker images from the exact verified server and CLI versions',
  );
});

test('nightly-dev gates installer smoke behind an explicit repository variable', async () => {
  const raw = await readFile(join(repoRoot, '.github', 'workflows', 'nightly-dev.yml'), 'utf8');

  assert.match(
    raw,
    /release_verify:[\s\S]*?run_installers_smoke:\s*\$\{\{\s*vars\.HAPPIER_ENABLE_INSTALLER_SMOKE == 'true'\s*\}\}/,
    'installer smoke needs the fork signing public key to match the MINISIGN_SECRET_KEY, so it should be opt-in',
  );
});

test('nightly-dev gates Expo-backed mobile publishing behind an explicit repository variable', async () => {
  const raw = await readFile(join(repoRoot, '.github', 'workflows', 'nightly-dev.yml'), 'utf8');

  for (const inputName of ['publish_ota', 'publish_android_apk', 'submit_ios_testflight']) {
    assert.match(
      raw,
      new RegExp(`${inputName}:\\s*\\$\\{\\{\\s*vars\\.HAPPIER_ENABLE_MOBILE_DEV_RELEASE == 'true'\\s*\\}\\}`),
      `${inputName} should be disabled by default in forks without Expo project permissions`,
    );
  }
});

test('nightly-dev preflights release write authority before expensive immutable candidates', async () => {
  const raw = await readFile(join(repoRoot, '.github', 'workflows', 'nightly-dev.yml'), 'utf8');
  const workflow = parse(raw);
  const jobs = workflow?.jobs ?? {};
  const preflight = jobs.release_preflight;
  const releaseActorGuard = jobs.release_actor_guard;

  assert.ok(releaseActorGuard, 'nightly-dev privileged preflight should require the release actor guard');
  assert.match(raw, /release_actor_guard:[\s\S]*?uses:\s*\.\/\.github\/actions\/release-actor-guard/);
  assert.ok(preflight, 'nightly-dev should fail fast on release credentials before building candidates');
  assert.deepEqual(preflight.needs, ['prepare_release_candidate', 'release_actor_guard']);
  assert.equal(preflight.environment, 'release-shared');
  assert.equal(preflight.permissions?.contents, 'write');
  assert.equal(preflight.env?.RELEASE_BOT_APP_ID, '${{ secrets.RELEASE_BOT_APP_ID }}');
  assert.equal(preflight.env?.RELEASE_BOT_PRIVATE_KEY, '${{ secrets.RELEASE_BOT_PRIVATE_KEY }}');
  assert.match(raw, /release-preflight-github-write\.mjs/, 'preflight should run the same GitHub ref write contract that failed in release publishing');
  assert.match(
    raw,
    /GH_TOKEN:\s*\${{\s*steps\.app_token\.outputs\.token != '' && steps\.app_token\.outputs\.token \|\| github\.token\s*}}/,
    'preflight should use the same App-token-or-github.token fallback path as release publishing',
  );

  for (const jobName of ['cli', 'hstack', 'server_runtime', 'ui_web', 'resolve_validation_risk']) {
    assert.deepEqual(
      jobs[jobName]?.needs,
      ['resolve_resume', 'prepare_release_candidate', 'release_preflight'].filter((need) => (
        jobName === 'resolve_validation_risk' ? need !== 'resolve_resume' : true
      )),
      `${jobName} should wait for release_preflight before spending release build/test time`,
    );
  }
});

test('reusable retry promotion jobs can create rolling tags with fork token fallback', async () => {
  for (const workflow of ['publish-cli-binaries.yml', 'publish-hstack-binaries.yml', 'publish-ui-web.yml']) {
    const raw = await readFile(join(repoRoot, '.github', 'workflows', workflow), 'utf8');
    assert.match(
      raw,
      /promote_existing:[\s\S]*?permissions:\n\s+contents:\s*write[\s\S]*?GH_TOKEN:\s*\${{\s*steps\.app_token\.outputs\.token != '' && steps\.app_token\.outputs\.token \|\| github\.token\s*}}/,
      `${workflow} retry promotion must grant contents: write to the reusable job so github.token fallback can create staging tags`,
    );
  }
});
