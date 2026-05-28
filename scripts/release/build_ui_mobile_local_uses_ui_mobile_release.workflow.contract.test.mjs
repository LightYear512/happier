import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('build-ui-mobile-local workflow delegates local builds to ui-mobile-release pipeline command', () => {
  const src = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'build-ui-mobile-local.yml'), 'utf8');
  const androidJob = src.match(/  build_android:[\s\S]*?(?=\n  build_ios:)/)?.[0] ?? '';

  assert.notEqual(androidJob, '', 'expected build_android job to be present');
  assert.match(src, /node scripts\/pipeline\/run\.mjs ui-mobile-release/);
  assert.match(src, /--native-build-mode local/);
  assert.match(androidJob, /dagger\/dagger-for-github@v8\.3\.0/);
  assert.match(androidJob, /version:\s*"0\.19\.11"/);
  assert.match(androidJob, /EXPO_APP_OWNER:\s*\$\{\{\s*vars\.EXPO_APP_OWNER\s*\}\}/);
  assert.match(androidJob, /EXPO_APP_SLUG:\s*\$\{\{\s*vars\.EXPO_APP_SLUG\s*\}\}/);
  assert.match(androidJob, /EXPO_PUBLIC_EAS_PROJECT_ID:\s*\$\{\{\s*vars\.EXPO_PUBLIC_EAS_PROJECT_ID\s*\}\}/);
  assert.match(androidJob, /EAS_PROJECT_ID:\s*\$\{\{\s*vars\.EAS_PROJECT_ID\s*\}\}/);
  assert.match(androidJob, /EXPO_EAS_PROJECT_ID:\s*\$\{\{\s*vars\.EXPO_EAS_PROJECT_ID\s*\}\}/);
  assert.match(androidJob, /EXPO_UPDATES_URL:\s*\$\{\{\s*vars\.EXPO_UPDATES_URL\s*\}\}/);
  assert.match(androidJob, /EXPO_ANDROID_PACKAGE:\s*\$\{\{\s*vars\.EXPO_ANDROID_PACKAGE\s*\}\}/);
  assert.match(androidJob, /--native-local-runtime dagger/);
  assert.match(src, /--action "\$\{\{\s*inputs\.action == 'build_and_submit' && 'native_submit' \|\| 'native'\s*\}\}"/);
  assert.match(src, /--publish-apk-release false/);
  assert.match(src, /APP_STORE_CONNECT_PUBLICDEV_EXTERNAL_GROUPS:\s*\$\{\{\s*vars\.APP_STORE_CONNECT_PUBLICDEV_EXTERNAL_GROUPS\s*\}\}/);
  assert.match(src, /APP_STORE_CONNECT_PREVIEW_EXTERNAL_GROUPS:\s*\$\{\{\s*vars\.APP_STORE_CONNECT_PREVIEW_EXTERNAL_GROUPS\s*\}\}/);
  assert.match(src, /APP_STORE_CONNECT_PRODUCTION_EXTERNAL_GROUPS:\s*\$\{\{\s*vars\.APP_STORE_CONNECT_PRODUCTION_EXTERNAL_GROUPS\s*\}\}/);
  assert.match(src, /-\s+internaldev\b/);
  assert.match(src, /-\s+internalpreview\b/);
  assert.match(src, /-\s+dev\b/);
  assert.match(src, /-\s+internaldev-store\b/);
  assert.match(src, /-\s+internalpreview-apk\b/);
  assert.match(src, /-\s+dev-apk\b/);
  assert.match(src, /-\s+preview-apk\b/);
  assert.match(src, /-\s+production-apk\b/);
  assert.match(src, /-\s+ota\b/);
  assert.doesNotMatch(src, /inputs\.environment == 'publicdev'/);
  assert.doesNotMatch(src, /\benv_name\b[\s\S]*?"publicdev"/);
  assert.doesNotMatch(src, /-\s+production-preview\b/);
  assert.doesNotMatch(src, /-\s+production-preview-apk\b/);
  assert.doesNotMatch(src, /node scripts\/pipeline\/run\.mjs expo-submit/);
});
