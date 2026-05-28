import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeChildProcessEnv, resolveMacosTauriSigningEnvOverrides } from './build-updater-artifacts.mjs';

test('macOS Tauri build scrubs empty Apple signing env so preview builds can run unsigned', () => {
  const overrides = resolveMacosTauriSigningEnvOverrides({
    APPLE_CERTIFICATE: '',
    APPLE_CERTIFICATE_PASSWORD: '',
    APPLE_SIGNING_IDENTITY: '',
  });

  const env = mergeChildProcessEnv(
    {
      APPLE_CERTIFICATE: '',
      APPLE_CERTIFICATE_PASSWORD: '',
      APPLE_SIGNING_IDENTITY: '',
      KEEP_ME: '1',
    },
    overrides,
  );

  assert.equal(env.KEEP_ME, '1');
  assert.equal(Object.hasOwn(env, 'APPLE_CERTIFICATE'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_CERTIFICATE_PASSWORD'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_SIGNING_IDENTITY'), false);
});

test('macOS Tauri build preserves complete Apple signing env', () => {
  assert.deepEqual(
    resolveMacosTauriSigningEnvOverrides({
      APPLE_CERTIFICATE: 'base64-p12',
      APPLE_CERTIFICATE_PASSWORD: 'p12-password',
      APPLE_SIGNING_IDENTITY: 'Developer ID Application: Example',
    }),
    {
      APPLE_CERTIFICATE: 'base64-p12',
      APPLE_CERTIFICATE_PASSWORD: 'p12-password',
      APPLE_SIGNING_IDENTITY: 'Developer ID Application: Example',
    },
  );
});
