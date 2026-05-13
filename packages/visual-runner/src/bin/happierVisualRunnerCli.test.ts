import { describe, expect, it, vi } from 'vitest';

import { createVisualRunnerCliUsage, runVisualRunnerCli } from './happier-visual-runner.js';

describe('happier-visual-runner cli', () => {
  it('prints usage for --help', async () => {
    const stdout = vi.fn();
    const exitCode = await runVisualRunnerCli(['--help'], {
      stdout,
      stderr: vi.fn(),
      startMcpServer: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(createVisualRunnerCliUsage());
  });

  it('starts the MCP stdio server for the mcp command', async () => {
    const startMcpServer = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const exitCode = await runVisualRunnerCli(['mcp'], {
      stdout: vi.fn(),
      stderr: vi.fn(),
      startMcpServer,
    });

    expect(exitCode).toBe(0);
    expect(startMcpServer).toHaveBeenCalledOnce();
  });

  it('fails closed for unknown commands', async () => {
    const stderr = vi.fn();

    const exitCode = await runVisualRunnerCli(['wat'], {
      stdout: vi.fn(),
      stderr,
      startMcpServer: vi.fn(),
    });

    expect(exitCode).toBe(2);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
  });
});
