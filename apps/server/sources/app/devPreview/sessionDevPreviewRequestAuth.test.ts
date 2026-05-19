import { describe, expect, it } from 'vitest';

import { parsePreviewTokenFromRequest } from './sessionDevPreviewRequestAuth';

describe('parsePreviewTokenFromRequest', () => {
  it('ignores malformed preview token cookie values', () => {
    const parsed = parsePreviewTokenFromRequest({
      url: '/preview/session_1/machine_1/route_1/',
      headers: {
        cookie: 'happier_dev_preview_token=%',
      },
    });

    expect(parsed).toEqual({
      previewToken: null,
      previewTokenSource: 'missing',
      forwardedSearch: '',
    });
  });
});
