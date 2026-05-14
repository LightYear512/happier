import { describe, expect, it, vi } from 'vitest';

import {
  createVisualRunnerMcpToolDispatcher,
  registerVisualRunnerMcpTools,
  visualRunnerMcpToolNames,
} from './visualRunnerMcpTools.js';

describe('visual runner MCP tools', () => {
  it('registers the Visual Runner tool catalog', () => {
    const registerTool = vi.fn();

    registerVisualRunnerMcpTools({ registerTool }, createVisualRunnerMcpToolDispatcher({
      defaultCwd: '/repo',
      generateSessionId: () => 'visual-session-1',
      now: () => new Date('2026-05-11T00:00:00.000Z'),
    }));

    expect(registerTool.mock.calls.map(([name]) => name)).toEqual(visualRunnerMcpToolNames);
  });

  it('returns a policy decision as MCP text content', async () => {
    const dispatcher = createVisualRunnerMcpToolDispatcher({
      defaultCwd: '/repo',
      generateSessionId: () => 'visual-session-1',
      now: () => new Date('2026-05-11T00:00:00.000Z'),
    });

    const result = await dispatcher.callTool('visual.resolve_url_policy', {
      url: 'https://example.com',
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
      ok: false,
      errorCode: 'policy_denied',
      reason: 'external_url_not_allowlisted',
    });
  });

  it('redacts text artifacts through the MCP dispatcher', async () => {
    const dispatcher = createVisualRunnerMcpToolDispatcher({
      defaultCwd: '/repo',
      generateSessionId: () => 'visual-session-1',
      now: () => new Date('2026-05-11T00:00:00.000Z'),
    });

    const result = await dispatcher.callTool('visual.redact_text_artifact', {
      text: 'authorization: Bearer abc\nnormal=value',
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
      text: 'authorization: [REDACTED]\nnormal=value',
    });
  });

  it('creates a session record without launching a browser yet', async () => {
    const dispatcher = createVisualRunnerMcpToolDispatcher({
      defaultCwd: '/repo',
      generateSessionId: () => 'visual-session-1',
      now: () => new Date('2026-05-11T00:00:00.000Z'),
    });

    const result = await dispatcher.callTool('visual.create_session', {
      policy: { allowedOrigins: ['https://preview.example.com'] },
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
      id: 'visual-session-1',
      cwd: '/repo',
      createdAt: '2026-05-11T00:00:00.000Z',
      status: 'running',
      policy: {
        allowExternalUrls: false,
        allowedOrigins: ['https://preview.example.com'],
      },
    });
  });

  it('returns and closes session records through stable MCP tools', async () => {
    const dispatcher = createVisualRunnerMcpToolDispatcher({
      defaultCwd: '/repo',
      generateSessionId: () => 'visual-session-1',
      now: () => new Date('2026-05-11T00:00:00.000Z'),
    });

    await dispatcher.callTool('visual.create_session', {});

    const getResult = await dispatcher.callTool('visual.get_session', {
      sessionId: 'visual-session-1',
    });
    expect(getResult.isError).toBe(false);
    expect(JSON.parse(getResult.content[0]?.text ?? '{}')).toMatchObject({
      id: 'visual-session-1',
      status: 'running',
    });

    const closeResult = await dispatcher.callTool('visual.close_session', {
      sessionId: 'visual-session-1',
    });
    expect(closeResult.isError).toBe(false);
    expect(JSON.parse(closeResult.content[0]?.text ?? '{}')).toMatchObject({
      id: 'visual-session-1',
      status: 'closed',
    });

    const missingResult = await dispatcher.callTool('visual.get_session', {
      sessionId: 'visual-session-1',
    });
    expect(missingResult.isError).toBe(true);
    expect(JSON.parse(missingResult.content[0]?.text ?? '{}')).toMatchObject({
      errorCode: 'session_not_found',
      sessionId: 'visual-session-1',
    });
  });

  it('returns stable MCP errors for invalid arguments', async () => {
    const dispatcher = createVisualRunnerMcpToolDispatcher({
      defaultCwd: '/repo',
      generateSessionId: () => 'visual-session-1',
      now: () => new Date('2026-05-11T00:00:00.000Z'),
    });

    const result = await dispatcher.callTool('visual.resolve_url_policy', {});

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      errorCode: 'invalid_arguments',
    });
  });
});
