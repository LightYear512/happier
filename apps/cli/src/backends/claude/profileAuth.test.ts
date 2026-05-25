import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { __test_claudeProfileAuth, claudeProfileAuthProvider } from './profileAuth';

describe('claudeProfileAuthProvider', () => {
  it('sends the login command once after Claude reports that the profile is not logged in', () => {
    const responder = __test_claudeProfileAuth.createClaudeProfileAuthOutputResponder();

    expect(responder({
      data: 'Not logged in. Run /login to authenticate.',
      outputBuffer: 'Welcome\nNot logged in. Run /login to authenticate.',
    })).toBe('/login\r');
    expect(responder({
      data: 'Not logged in. Run /login to authenticate.',
      outputBuffer: 'Welcome\nNot logged in. Run /login to authenticate.',
    })).toBeNull();
  });

  it('forces a fresh login flow when Claude reports an existing account before login starts', () => {
    const responder = __test_claudeProfileAuth.createClaudeProfileAuthOutputResponder();

    expect(responder({
      data: 'Welcome back, test@example.com',
      outputBuffer: 'Welcome back, test@example.com',
    })).toBe('/login\r');
  });

  it('confirms Claude interactive prompts that appear during login', () => {
    const responder = __test_claudeProfileAuth.createClaudeProfileAuthOutputResponder();

    expect(responder({
      data: 'Select login method',
      outputBuffer: 'Select login method',
    })).toBe('\r');
    expect(responder({
      data: 'rendered menu body',
      outputBuffer: 'Select login method\nChoose the text style',
    })).toBe('2\r');
    expect(responder({
      data: 'Choose the text style',
      outputBuffer: 'Select login method\nChoose the text style',
    })).toBeNull();
  });

  it('uses the cumulative PTY output buffer for Claude prompt responses', () => {
    const responder = __test_claudeProfileAuth.createClaudeProfileAuthOutputResponder();

    expect(responder({
      data: 'Claude prompt ready',
      outputBuffer: 'Choose the text style\nClaude prompt ready',
    })).toBe('2\r');
  });

  it('recognizes Claude prompts rendered with cursor-positioning ANSI sequences', () => {
    const responder = __test_claudeProfileAuth.createClaudeProfileAuthOutputResponder();

    expect(responder({
      data: '\u001B[2GChoose\u001B[9Gthe\u001B[13Gtext\u001B[18Gstyle',
      outputBuffer: '\u001B[2GChoose\u001B[9Gthe\u001B[13Gtext\u001B[18Gstyle',
    })).toBe('2\r');
  });

  it('does not synthesize a login URL when Claude prints the real OAuth link', () => {
    const responder = __test_claudeProfileAuth.createClaudeProfileAuthOutputResponder();

    expect(responder({
      data: 'Open https://claude.ai/oauth/authorize?code=true in your browser',
      outputBuffer: 'Open https://claude.ai/oauth/authorize?code=true in your browser',
    })).toBeNull();
  });

  it('builds a Claude login context that waits for PTY output instead of writing /login immediately', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'happier-claude-profile-auth-'));
    const claudePath = join(tempDir, 'claude');
    await writeFile(claudePath, '#!/bin/sh\necho ok\n', 'utf8');
    await chmod(claudePath, 0o755);

    const context = await claudeProfileAuthProvider.buildIsolatedLoginContext({
      profileDir: '/tmp/happier/profiles/claude/work',
      processEnv: {
        PATH: '/usr/bin',
        HAPPIER_CLAUDE_PATH: claudePath,
      },
    });

    expect(context).not.toHaveProperty('initialInput');
    expect(context.terminalOutputResponder).toBeTypeOf('function');
  });
});
