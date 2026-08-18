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

test('publish-ui-mobile-dev falls back to GITHUB_TOKEN when release bot secrets are absent', async () => {
  const raw = await loadWorkflow('publish-ui-mobile-dev.yml');

  assert.match(
    raw,
    /RELEASE_BOT_APP_ID:\s*\$\{\{\s*secrets\.RELEASE_BOT_APP_ID\s*\}\}[\s\S]*?RELEASE_BOT_PRIVATE_KEY:\s*\$\{\{\s*secrets\.RELEASE_BOT_PRIVATE_KEY\s*\}\}/,
    'mobile dev jobs should expose release bot secrets through env for conditional token creation',
  );
  assert.match(
    raw,
    /Create GitHub App token[\s\S]*?if:\s*\$\{\{\s*env\.RELEASE_BOT_APP_ID != '' && env\.RELEASE_BOT_PRIVATE_KEY != ''\s*\}\}/,
    'release bot token creation should be skipped when the fork has no app secrets',
  );
  assert.match(
    raw,
    /token:\s*\$\{\{\s*\(?steps\.app_token\.outputs\.token != '' && steps\.app_token\.outputs\.token\)? \|\| github\.token\s*\}\}/,
    'mobile source checkout should fall back to GITHUB_TOKEN in forks',
  );
});

test('publish-ui-mobile-dev passes fork Expo app identity through mobile release steps', async () => {
  const raw = await loadWorkflow('publish-ui-mobile-dev.yml');

  const otaSteps = [
    ...raw.matchAll(/- name: (?:Prepare|Publish) (?:Android|iOS) OTA [^\n]+[\s\S]*?(?=\n      - name:)/g),
  ].map((match) => match[0]);
  const androidCloudStep =
    raw.match(/- name: Android APK \(dev lane\) \+ rolling GitHub release[\s\S]*?(?=\n      - name: Install Dagger)/)?.[0] ?? '';
  const androidLocalStep =
    raw.match(/- name: Android APK \(dev lane\) \(local via Dagger\) \+ rolling GitHub release[\s\S]*?(?=\n      - name: Note)/)?.[0] ?? '';
  const iosSubmitSteps = [
    ...raw.matchAll(/- name: iOS TestFlight submit \(dev lane\) \(best-effort\)[\s\S]*?(?=\n\s{6}- name:|\n\s{2}ios_|\n\s*$)/g),
  ].map((match) => match[0]);

  assert.equal(otaSteps.length, 4, 'expected split OTA prepare/publish steps to be present');
  assert.notEqual(androidCloudStep, '', 'expected Android cloud release step to be present');
  assert.notEqual(androidLocalStep, '', 'expected Android local release step to be present');
  assert.equal(iosSubmitSteps.length, 2, 'expected both iOS submit steps to be present');

  for (const step of [...otaSteps, androidCloudStep, androidLocalStep, ...iosSubmitSteps]) {
    assert.match(step, /EXPO_APP_OWNER:\s*\$\{\{\s*vars\.EXPO_APP_OWNER\s*\}\}/);
    assert.match(step, /EXPO_APP_SLUG:\s*\$\{\{\s*vars\.EXPO_APP_SLUG\s*\}\}/);
    assert.match(step, /EXPO_PUBLIC_EAS_PROJECT_ID:\s*\$\{\{\s*vars\.EXPO_PUBLIC_EAS_PROJECT_ID\s*\}\}/);
    assert.match(step, /EAS_PROJECT_ID:\s*\$\{\{\s*vars\.EAS_PROJECT_ID\s*\}\}/);
    assert.match(step, /EXPO_EAS_PROJECT_ID:\s*\$\{\{\s*vars\.EXPO_EAS_PROJECT_ID\s*\}\}/);
    assert.match(step, /EXPO_UPDATES_URL:\s*\$\{\{\s*vars\.EXPO_UPDATES_URL\s*\}\}/);
  }
});
