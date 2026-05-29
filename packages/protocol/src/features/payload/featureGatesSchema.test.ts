import { describe, expect, it } from 'vitest';

import { readServerEnabledBit } from '../serverEnabledBit.js';
import { FeaturesResponseSchema } from './featuresResponseSchema.js';

describe('FeatureGatesSchema', () => {
  it('preserves pets companion and sync gates', () => {
    const parsed = FeaturesResponseSchema.parse({
      features: {
        pets: {
          companion: { enabled: true },
          sync: { enabled: true },
        },
      },
      capabilities: {},
    });

    expect(readServerEnabledBit(parsed, 'pets.companion')).toBe(true);
    expect(readServerEnabledBit(parsed, 'pets.sync')).toBe(true);
  });

  it('preserves channel bridge gates', () => {
    const parsed = FeaturesResponseSchema.parse({
      features: {
        channelBridges: {
          enabled: true,
          telegram: { enabled: true },
        },
      },
      capabilities: {},
    });

    expect(readServerEnabledBit(parsed, 'channelBridges')).toBe(true);
    expect(readServerEnabledBit(parsed, 'channelBridges.telegram')).toBe(true);
  });

  it('preserves generated session media gates separately from attachment upload gates', () => {
    const parsed = FeaturesResponseSchema.parse({
      features: {
        attachments: {
          uploads: { enabled: true },
        },
        session: {
          media: {
            generated: { enabled: true },
          },
        },
      },
      capabilities: {},
    });

    expect(readServerEnabledBit(parsed, 'attachments.uploads')).toBe(true);
    expect(readServerEnabledBit(parsed, 'session.media.generated')).toBe(true);
  });

  it('preserves session folder gates under sessions', () => {
    const parsed = FeaturesResponseSchema.parse({
      features: {
        sessions: {
          enabled: true,
          folders: { enabled: true },
        },
      },
      capabilities: {},
    });

    expect(readServerEnabledBit(parsed, 'sessions.folders')).toBe(true);
  });

  it('preserves session dev preview relay gates', () => {
    const parsed = FeaturesResponseSchema.parse({
      features: {
        sessions: {
          enabled: true,
          devPreview: {
            enabled: true,
            relay: {
              enabled: true,
              host: {
                enabled: true,
                configured: true,
                baseDomain: 'preview.example.com',
                suggestedBaseDomain: null,
              },
              path: {
                enabled: false,
              },
            },
          },
        },
      },
      capabilities: {},
    });

    expect(readServerEnabledBit(parsed, 'sessions')).toBe(true);
    expect(readServerEnabledBit(parsed, 'sessions.devPreview')).toBe(true);
    expect(readServerEnabledBit(parsed, 'sessions.devPreview.relay')).toBe(true);
    expect(parsed.features.sessions.devPreview.relay.host.baseDomain).toBe('preview.example.com');
    expect(parsed.features.sessions.devPreview.relay.path.enabled).toBe(false);
  });
});
