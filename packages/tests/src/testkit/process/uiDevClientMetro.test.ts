import { describe, expect, it } from 'vitest';

import { resolveUiDevClientMetroNodeOptions } from './uiDevClientMetro';

describe('resolveUiDevClientMetroNodeOptions', () => {
  it('adds a bounded heap override for dev-client Metro by default', () => {
    expect(resolveUiDevClientMetroNodeOptions({})).toBe('--max-old-space-size=8192');
  });

  it('keeps existing node options while adding the dev-client Metro heap override', () => {
    expect(resolveUiDevClientMetroNodeOptions({ NODE_OPTIONS: '--trace-warnings' })).toBe(
      '--trace-warnings --max-old-space-size=8192',
    );
  });

  it('lets callers configure the dev-client Metro heap size', () => {
    expect(
      resolveUiDevClientMetroNodeOptions({
        NODE_OPTIONS: '--trace-warnings',
        HAPPIER_E2E_DEV_CLIENT_METRO_MAX_OLD_SPACE_SIZE_MB: '12288',
      }),
    ).toBe('--trace-warnings --max-old-space-size=12288');
  });

  it('preserves an explicit max-old-space-size already supplied by the caller', () => {
    expect(
      resolveUiDevClientMetroNodeOptions({
        NODE_OPTIONS: '--max-old-space-size=4096 --trace-warnings',
        HAPPIER_E2E_DEV_CLIENT_METRO_MAX_OLD_SPACE_SIZE_MB: '12288',
      }),
    ).toBe('--max-old-space-size=4096 --trace-warnings');
  });
});
