import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SimulatorScreenshotFrame } from './simulatorScreenshotFrame';

export type IosSimctlFrameCaptureOptions = Readonly<{
  xcrunPath?: string;
  deviceId?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}>;

const DEFAULT_SIMCTL_SCREENSHOT_TIMEOUT_MS = 5_000;

function runCommand(params: Readonly<{
  command: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, [...params.args], {
      env: params.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeoutMs = params.timeoutMs ?? DEFAULT_SIMCTL_SCREENSHOT_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      settle(() => {
        child.kill('SIGKILL');
        reject(new Error(`${params.command} simctl screenshot timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);
    timeout.unref?.();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.once('error', (error) => {
      settle(() => reject(error));
    });
    child.once('close', (code) => {
      settle(() => {
        if (code === 0) {
          resolve(Buffer.concat(stdout));
          return;
        }
        const message = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(message || `${params.command} exited with ${code ?? 'unknown status'}`));
      });
    });
    child.stdin.end();
  });
}

export function createIosSimctlFrameCapture(
  options: IosSimctlFrameCaptureOptions = {},
): () => Promise<SimulatorScreenshotFrame> {
  const xcrunPath = options.xcrunPath ?? 'xcrun';
  const env = options.env ?? process.env;
  const timeoutMs = Math.max(50, options.timeoutMs ?? DEFAULT_SIMCTL_SCREENSHOT_TIMEOUT_MS);

  return async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'happier-ios-simctl-'));
    const outputPath = join(tempDir, 'frame.jpg');
    try {
      await runCommand({
        command: xcrunPath,
        args: ['simctl', 'io', options.deviceId ?? 'booted', 'screenshot', '--type=jpeg', outputPath],
        env,
        timeoutMs,
      });
      const jpeg = await readFile(outputPath);
      if (jpeg.length === 0) {
        throw new Error('xcrun simctl screenshot returned an empty frame');
      }
      return {
        body: jpeg,
        contentType: 'image/jpeg',
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
