import { describe, expect, it } from 'vitest';

import {
  VisualArtifactRefSchema,
  VisualErrorCodeSchema,
  VisualSessionSchema,
  redactVisualTextArtifact,
  resolveVisualUrlPolicy,
} from './index.js';

describe('visual runner contract', () => {
  it('allows loopback URLs by default and denies external URLs', () => {
    expect(resolveVisualUrlPolicy({ url: 'http://localhost:5173' })).toEqual({ ok: true });
    expect(resolveVisualUrlPolicy({ url: 'http://127.0.0.1:3000' })).toEqual({ ok: true });
    expect(resolveVisualUrlPolicy({ url: 'http://[::1]:8080' })).toEqual({ ok: true });

    expect(resolveVisualUrlPolicy({ url: 'https://example.com' })).toEqual({
      ok: false,
      errorCode: 'policy_denied',
      reason: 'external_url_not_allowlisted',
    });
  });

  it('allows external URLs only when they match the explicit allowlist', () => {
    expect(resolveVisualUrlPolicy({
      url: 'https://preview.example.com/app',
      policy: { allowedOrigins: ['https://preview.example.com'] },
    })).toEqual({ ok: true });

    expect(resolveVisualUrlPolicy({
      url: 'https://evil.example.com/app',
      policy: { allowedOrigins: ['https://preview.example.com'] },
    })).toEqual({
      ok: false,
      errorCode: 'policy_denied',
      reason: 'external_url_not_allowlisted',
    });
  });

  it('rejects invalid URLs with a stable error code', () => {
    expect(resolveVisualUrlPolicy({ url: 'not a url' })).toEqual({
      ok: false,
      errorCode: 'policy_denied',
      reason: 'invalid_url',
    });
  });

  it('redacts common token, cookie, and authorization fields from text artifacts', () => {
    expect(redactVisualTextArtifact([
      'authorization: Bearer secret-token',
      'cookie: sid=abc; theme=dark',
      'access_token=abc123',
      'normal=value',
    ].join('\n'))).toBe([
      'authorization: [REDACTED]',
      'cookie: [REDACTED]',
      'access_token=[REDACTED]',
      'normal=value',
    ].join('\n'));
  });

  it('defines stable session, artifact, and error-code schemas', () => {
    expect(VisualSessionSchema.parse({
      id: 'visual-session-1',
      cwd: '/repo',
      createdAt: '2026-05-11T00:00:00.000Z',
      status: 'running',
      policy: {},
    })).toMatchObject({ id: 'visual-session-1', status: 'running' });

    expect(VisualArtifactRefSchema.parse({
      id: 'artifact-1',
      kind: 'screenshot',
      mimeType: 'image/png',
      createdAt: '2026-05-11T00:00:01.000Z',
      expiresAt: '2026-05-11T01:00:01.000Z',
      sizeBytes: 1024,
    })).toMatchObject({ id: 'artifact-1', kind: 'screenshot' });

    expect(VisualErrorCodeSchema.options).toContain('policy_denied');
    expect(VisualErrorCodeSchema.options).toContain('browser_crashed');
    expect(VisualErrorCodeSchema.options).toContain('artifact_expired');
  });
});
