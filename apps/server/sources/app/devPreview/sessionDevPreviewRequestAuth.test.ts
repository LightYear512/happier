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

  it('strips previewToken without changing bare Vite query flags', () => {
    const parsed = parsePreviewTokenFromRequest({
      url: '/src/components/TopBar.vue?vue&type=style&index=0&scoped=abc&lang.css&previewToken=token_1',
      headers: {},
    });

    expect(parsed).toEqual({
      previewToken: 'token_1',
      previewTokenSource: 'query',
      forwardedSearch: '?vue&type=style&index=0&scoped=abc&lang.css',
    });
  });
});
