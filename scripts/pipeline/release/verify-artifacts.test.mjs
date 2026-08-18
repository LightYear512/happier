import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveServerBinarySmokeEnv } from './verify-artifacts.mjs';

test('server artifact smoke disables session dev preview relay when no deployment host is configured', () => {
  const env = resolveServerBinarySmokeEnv({
    baseEnv: {
      NODE_ENV: 'production',
    },
    scratch: '/tmp/happier-smoke',
  });

  assert.equal(env.PORT, '0');
  assert.equal(env.METRICS_PORT, '0');
  assert.equal(env.HAPPIER_SERVER_LIGHT_DATA_DIR, '/tmp/happier-smoke/server-light-data');
  assert.equal(env.HAPPIER_FEATURE_SESSIONS_DEV_PREVIEW_RELAY__ENABLED, '0');
});
