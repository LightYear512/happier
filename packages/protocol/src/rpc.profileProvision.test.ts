import { describe, expect, it } from 'vitest';

import { RPC_METHODS } from './rpc';

describe('RPC_METHODS profile provisioning', () => {
  it('includes daemon methods for profile provisioning and session profile switching', () => {
    expect(RPC_METHODS.PROFILE_PROVISION).toBe('daemon.profileProvision');
    expect(RPC_METHODS.PROFILE_PROVISION_POLL_PROGRESS).toBe('daemon.profileProvisionPollProgress');
    expect(RPC_METHODS.SESSION_SWITCH_PROFILE).toBe('daemon.sessionSwitchProfile');
  });
});
