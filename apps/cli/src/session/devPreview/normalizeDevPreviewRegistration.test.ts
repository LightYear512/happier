import { describe, expect, it } from 'vitest';

import { normalizeDevPreviewRegistration } from './normalizeDevPreviewRegistration';

describe('normalizeDevPreviewRegistration', () => {
  it('derives port, origin, and initial path from a loopback preview URL', () => {
    const normalized = normalizeDevPreviewRegistration({
      sessionId: 'session_1',
      machineId: 'machine_1',
      url: 'http://127.0.0.1:5173/ai-console/develop/?tab=ideas#today',
      name: 'Vite app',
      framework: 'vite',
    });

    expect(normalized.port).toBe(5173);
    expect(normalized.origin).toBe('http://127.0.0.1:5173');
    expect(normalized.url).toBe('http://127.0.0.1:5173/ai-console/develop/?tab=ideas#today');
    expect(normalized.initialPath).toBe('/ai-console/develop/');
    expect(normalized.compositeKey).toContain('/ai-console/develop/');
  });

  it('canonicalizes wildcard listener URLs to a reachable loopback origin', () => {
    const normalized = normalizeDevPreviewRegistration({
      sessionId: 'session_1',
      machineId: 'machine_1',
      url: 'http://0.0.0.0:5173/dashboard',
    });

    expect(normalized.origin).toBe('http://127.0.0.1:5173');
    expect(normalized.url).toBe('http://127.0.0.1:5173/dashboard');
  });

  it('rejects non-loopback preview URLs', () => {
    expect(() => normalizeDevPreviewRegistration({
      sessionId: 'session_1',
      machineId: 'machine_1',
      url: 'https://example.com/',
    })).toThrow(/loopback/);
  });

  it('rejects registrations without a port or URL', () => {
    expect(() => normalizeDevPreviewRegistration({
      sessionId: 'session_1',
      machineId: 'machine_1',
    })).toThrow(/port or url/);
  });
});
