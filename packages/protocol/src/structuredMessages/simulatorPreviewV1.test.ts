import { describe, expect, it } from 'vitest';

import { SimulatorPreviewV1Schema } from './simulatorPreviewV1';

describe('SimulatorPreviewV1Schema', () => {
  it('parses a simulator preview payload with a screen stream URL', () => {
    const parsed = SimulatorPreviewV1Schema.parse({
      simulatorSessionId: 'sim_1',
      sessionId: 's1',
      platform: 'android',
      deviceName: 'Pixel 8',
      appName: 'Happier',
      streamUrl: 'https://relay.example.test/simulator/sim_1/frame.jpg',
      mode: 'user_control',
      owner: 'user',
      connectionPath: 'relay',
      registeredAtMs: 1,
    });

    expect(parsed.streamUrl).toBe('https://relay.example.test/simulator/sim_1/frame.jpg');
  });

  it('rejects non-http simulator stream URLs', () => {
    expect(() => SimulatorPreviewV1Schema.parse({
      simulatorSessionId: 'sim_1',
      sessionId: 's1',
      platform: 'android',
      deviceName: 'Pixel 8',
      streamUrl: 'javascript:alert(1)',
      mode: 'user_control',
      connectionPath: 'relay',
      registeredAtMs: 1,
    })).toThrow();
  });
});
