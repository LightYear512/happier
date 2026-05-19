import { describe, expect, it } from 'vitest';

import { rewritePreviewContentSecurityPolicy } from './rewritePreviewContentSecurityPolicy';

describe('rewritePreviewContentSecurityPolicy', () => {
  it('adds a nonce to script-src policies that allow script execution', () => {
    const result = rewritePreviewContentSecurityPolicy({
      headerValues: [`default-src 'self'; script-src 'self' https://cdn.example.test`],
      nonce: 'preview_nonce_1',
    });

    expect(result).toEqual({
      mode: 'inject',
      headerValues: [`default-src 'self'; script-src 'self' https://cdn.example.test 'nonce-preview_nonce_1'`],
    });
  });

  it('derives a script-src directive from default-src when script-src is absent', () => {
    const result = rewritePreviewContentSecurityPolicy({
      headerValues: [`default-src 'self' https://cdn.example.test`],
      nonce: 'preview_nonce_2',
    });

    expect(result).toEqual({
      mode: 'inject',
      headerValues: [`default-src 'self' https://cdn.example.test; script-src 'self' https://cdn.example.test 'nonce-preview_nonce_2'`],
    });
  });

  it('blocks injection when any CSP policy forbids scripts entirely', () => {
    const result = rewritePreviewContentSecurityPolicy({
      headerValues: [`default-src 'self'; script-src 'none'`],
      nonce: 'preview_nonce_3',
    });

    expect(result).toEqual({
      mode: 'blocked',
      reason: 'script-src-none',
    });
  });

  it('blocks injection for strict-dynamic policies that cannot be widened safely', () => {
    const result = rewritePreviewContentSecurityPolicy({
      headerValues: [`script-src 'strict-dynamic' https: http:`],
      nonce: 'preview_nonce_4',
    });

    expect(result).toEqual({
      mode: 'blocked',
      reason: 'script-src-strict-dynamic',
    });
  });
});
