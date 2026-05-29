import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

  it('emits an Android simulator MCP tool call in the simulator preview scenario', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'fake-claude-simulator-mcp-'));
    const logPath = join(tempDir, 'fake-claude.jsonl');
    const child = execFile(
      process.execPath,
      [
        fakeClaudeFixturePath(),
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
      ],
      {
        timeout: 5_000,
        env: {
          ...process.env,
          HAPPIER_E2E_FAKE_CLAUDE_LOG: logPath,
          HAPPIER_E2E_FAKE_CLAUDE_SCENARIO: 'simulator-preview-android-mcp-start',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_DEVICE_ID: 'emulator-5554',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_PORT: '9812',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_POLL_MS: '500',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_DEVICE_NAME: 'Android SDK API 34',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_APP_NAME: 'Android Preview Fixture',
        },
      },
    );

    child.stdin?.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'start Android preview' } })}\n`);
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(`fake Claude exited with ${signal ?? code}: ${stderr}`));
      });
    });

    expect(result.stdout).toContain('"name":"mcp__happier__happier_simulator_preview_android_start"');
    expect(result.stdout).toContain('"tool_use_id":"tool_simulator_preview_android_start_1"');
    expect(result.stdout).toContain('Missing MCP server config');
    const logRows = (await readFile(logPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(logRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'mcp_tool_call_failed',
        toolName: 'happier_simulator_preview_android_start',
      }),
    ]));
  });

  it('emits an iOS simulator MCP tool call in the simulator preview scenario', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'fake-claude-simulator-ios-mcp-'));
    const logPath = join(tempDir, 'fake-claude.jsonl');
    const child = execFile(
      process.execPath,
      [
        fakeClaudeFixturePath(),
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
      ],
      {
        timeout: 5_000,
        env: {
          ...process.env,
          HAPPIER_E2E_FAKE_CLAUDE_LOG: logPath,
          HAPPIER_E2E_FAKE_CLAUDE_SCENARIO: 'simulator-preview-ios-mcp-start',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_DEVICE_ID: 'A1B2-C3D4',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_WDA_URL: 'http://127.0.0.1:8100',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_PORT: '9814',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_POLL_MS: '500',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_DEVICE_NAME: 'iPhone 15 Pro',
          HAPPIER_E2E_FAKE_CLAUDE_SIMULATOR_APP_NAME: 'iOS Preview Fixture',
        },
      },
    );

    child.stdin?.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'start iOS preview' } })}\n`);
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(`fake Claude exited with ${signal ?? code}: ${stderr}`));
      });
    });

    expect(result.stdout).toContain('"name":"mcp__happier__happier_simulator_preview_ios_start"');
    expect(result.stdout).toContain('"tool_use_id":"tool_simulator_preview_ios_start_1"');
    expect(result.stdout).toContain('Missing MCP server config');
    const logRows = (await readFile(logPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(logRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'mcp_tool_call_failed',
        toolName: 'happier_simulator_preview_ios_start',
      }),
    ]));
  });
});
