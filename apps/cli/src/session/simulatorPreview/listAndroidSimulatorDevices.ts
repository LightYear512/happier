import { spawn } from 'node:child_process';

import type { DiscoveredSimulatorDevice } from './simulatorDeviceTypes';

export type ListAndroidSimulatorDevicesOptions = Readonly<{
  adbPath?: string;
  env?: NodeJS.ProcessEnv;
  runCommand?: (command: string, args: readonly string[]) => Promise<string>;
}>;

function normalizeText(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAdbDeviceLine(line: string): DiscoveredSimulatorDevice | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('List of devices')) return null;
  const [deviceId, state, ...details] = trimmed.split(/\s+/u);
  if (!deviceId || !state) return null;
  const modelDetail = details.find((part) => part.startsWith('model:'));
  const rawModel = modelDetail ? modelDetail.slice('model:'.length).replace(/_/gu, ' ') : '';
  return {
    platform: 'android',
    deviceId,
    displayName: normalizeText(rawModel) || deviceId,
    state: state === 'device' ? 'booted' : state === 'offline' ? 'offline' : 'unknown',
  };
}

function createRunCommand(options: Readonly<{
  adbPath: string;
  env: NodeJS.ProcessEnv;
}>): (command: string, args: readonly string[]) => Promise<string> {
  return async (command, args) => await new Promise<string>((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
        return;
      }
      const message = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(message || `${options.adbPath} devices exited with ${code ?? 'unknown status'}`));
    });
  });
}

export async function listAndroidSimulatorDevices(
  options: ListAndroidSimulatorDevicesOptions = {},
): Promise<readonly DiscoveredSimulatorDevice[]> {
  const adbPath = options.adbPath ?? 'adb';
  const runCommand = options.runCommand ?? createRunCommand({
    adbPath,
    env: options.env ?? process.env,
  });
  const output = await runCommand(adbPath, ['devices', '-l']);
  return output
    .split(/\r?\n/u)
    .map(parseAdbDeviceLine)
    .filter((device): device is DiscoveredSimulatorDevice => Boolean(device));
}
