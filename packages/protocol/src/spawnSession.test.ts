import { describe, expect, it } from 'vitest';

import { SPAWN_SESSION_ERROR_CODES } from './spawnSession';

describe('SPAWN_SESSION_ERROR_CODES', () => {
  it('includes profile provisioning failures as a stable spawn error code', () => {
    expect(SPAWN_SESSION_ERROR_CODES.PROFILE_NOT_PROVISIONED).toBe('PROFILE_NOT_PROVISIONED');
  });
});
