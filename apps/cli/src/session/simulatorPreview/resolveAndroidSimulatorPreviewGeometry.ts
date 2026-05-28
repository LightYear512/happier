import { spawn } from 'node:child_process';

export type AndroidSimulatorPreviewGeometry = Readonly<{
  deviceWidth: number;
  deviceHeight: number;
}>;

export type ResolveAndroidSimulatorPreviewGeometryOptions = Readonly<{
  adbPath?: string;
  deviceId?: string;
  env?: NodeJS.ProcessEnv;
}>;

function parseWmSize(output: string): AndroidSimulatorPreviewGeometry {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const override = lines.find((line) => /^Override size:/i.test(line));
  const physical = lines.find((line) => /^Physical size:/i.test(line));
  const selected = override ?? physical ?? '';
  const match = /(\d+)x(\d+)/.exec(selected);
  if (!match) {
    throw new Error('Unable to parse Android display size');
  }
  const deviceWidth = Number.parseInt(match[1]!, 10);
  const deviceHeight = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(deviceWidth) || !Number.isFinite(deviceHeight) || deviceWidth <= 0 || deviceHeight <= 0) {
    throw new Error('Unable to parse Android display size');
  }
  return { deviceWidth, deviceHeight };
}

export async function resolveAndroidSimulatorPreviewGeometry(
  options: ResolveAndroidSimulatorPreviewGeometryOptions = {},
): Promise<AndroidSimulatorPreviewGeometry> {
  const adbPath = options.adbPath ?? 'adb';
  const args = [
    ...(options.deviceId ? ['-s', options.deviceId] : []),
    'shell',
    'wm',
    'size',
  ];
  const stdout = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(adbPath, args, {
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk) => out.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => err.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out));
        return;
      }
      const message = Buffer.concat(err).toString('utf8').trim();
      reject(new Error(message || `${adbPath} wm size exited with ${code ?? 'unknown status'}`));
    });
  });
  return parseWmSize(stdout.toString('utf8'));
}
