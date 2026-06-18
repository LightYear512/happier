import { describe, expect, it } from 'vitest';

import { RPC_METHODS } from './rpc.js';

describe('RPC_METHODS (dev preview relay)', () => {
  it('includes the daemon HTTP relay method', () => {
    expect((RPC_METHODS as any).DAEMON_SESSION_DEV_PREVIEW_HTTP).toBe('daemon.sessionDevPreview.http');
  });

  it('includes the daemon close method', () => {
    expect((RPC_METHODS as any).DAEMON_SESSION_DEV_PREVIEW_CLOSE).toBe('daemon.sessionDevPreview.close');
  });
});
