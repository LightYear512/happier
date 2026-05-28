import { spawn } from 'node:child_process';

import type { AndroidScreenshotFrame } from './androidScreenshotFrame';

export type AndroidScreencapFrameCaptureOptions = Readonly<{
  adbPath?: string;
  deviceId?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}>;

const DEFAULT_ADB_SCREENCAP_TIMEOUT_MS = 5_000;

function runCommand(params: Readonly<{
  command: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  input?: Buffer;
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
    const timeoutMs = params.timeoutMs ?? DEFAULT_ADB_SCREENCAP_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      settle(() => {
        child.kill('SIGKILL');
        reject(new Error(`${params.command} screencap timed out after ${timeoutMs}ms`));
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
    if (params.input) {
      child.stdin.end(params.input);
    } else {
      child.stdin.end();
    }
  });
}

export function createAndroidScreencapFrameCapture(
  options: AndroidScreencapFrameCaptureOptions = {},
): () => Promise<AndroidScreenshotFrame> {
  const adbPath = options.adbPath ?? 'adb';
  const env = options.env ?? process.env;
  const timeoutMs = Math.max(50, options.timeoutMs ?? DEFAULT_ADB_SCREENCAP_TIMEOUT_MS);

  return async () => {
    const adbArgs = [
      ...(options.deviceId ? ['-s', options.deviceId] : []),
      'exec-out',
      'screencap',
      '-p',
    ];
    const png = await runCommand({
      command: adbPath,
      args: adbArgs,
      env,
      timeoutMs,
    });
    if (png.length === 0) {
      throw new Error('adb screencap returned an empty frame');
    }
    return {
      body: png,
      contentType: 'image/png',
    };
  };
}
