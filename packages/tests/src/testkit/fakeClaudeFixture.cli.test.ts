import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { fakeClaudeFixturePath } from './fakeClaude';

const execFileAsync = promisify(execFile);

describe('fake Claude CLI fixture', () => {
  it.each([
    ['--version'],
    ['version'],
  ])('returns version output without entering interactive mode for %s', async (arg) => {
    const result = await execFileAsync(process.execPath, [fakeClaudeFixturePath(), arg], {
      timeout: 1_000,
    });

    expect(result.stdout.trim()).toBe('0.0.0-fake');
    expect(result.stderr).toBe('');
  });
});
