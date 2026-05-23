import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  parseProvisionedProfileId,
  resolveProvisionedProfileCredentialPaths,
  resolveProvisionedProfileDir,
} from './profileProvisionPaths';

describe('profileProvisionPaths', () => {
  it('resolves native CLI profile directories under the active server .happier area', () => {
    expect(resolveProvisionedProfileDir({
      activeServerDir: '/home/alice/.happier/servers/cloud',
      backendId: 'claude',
      profileId: 'work',
    })).toBe(join('/home/alice/.happier/servers/cloud', 'profiles', 'native-cli', 'claude', 'work'));
  });

  it('keeps credential probes inside the native CLI profile directory', () => {
    expect(resolveProvisionedProfileCredentialPaths({
      activeServerDir: '/home/alice/.happier/servers/cloud',
      backendId: 'codex',
      profileId: 'work',
    })).toEqual([
      join('/home/alice/.happier/servers/cloud', 'profiles', 'native-cli', 'codex', 'work', 'auth.json'),
    ]);
  });

  it('rejects path traversal profile ids before resolving paths', () => {
    expect(parseProvisionedProfileId('../work')).toBeNull();
    expect(resolveProvisionedProfileCredentialPaths({
      activeServerDir: '/home/alice/.happier/servers/cloud',
      backendId: 'codex',
      profileId: '../work',
    })).toEqual([]);
  });
});
