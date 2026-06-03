import { spawn } from 'node:child_process';

import type { DiscoveredSimulatorDevice } from './simulatorDeviceTypes';

export type ListIosSimulatorDevicesOptions = Readonly<{
  xcrunPath?: string;
  env?: NodeJS.ProcessEnv;
  runCommand?: (command: string, args: readonly string[]) => Promise<string>;
}>;

type SimctlDevice = Readonly<{
  name?: unknown;
  udid?: unknown;
  state?: unknown;
  isAvailable?: unknown;
}>;

type SimctlListDevicesPayload = Readonly<{
  devices?: Record<string, readonly SimctlDevice[]>;
}>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isIosRuntime(runtimeId: string): boolean {
  return /(?:^|[.])iOS[-.]/i.test(runtimeId) || /simruntime\.ios/i.test(runtimeId);
}

function mapState(value: unknown): DiscoveredSimulatorDevice['state'] {
  const state = normalizeText(value).toLowerCase();
  if (state === 'booted') return 'booted';
  if (state === 'shutdown') return 'available';
  return 'unknown';
}

function createRunCommand(options: Readonly<{
  xcrunPath: string;
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
      reject(new Error(message || `${options.xcrunPath} simctl list exited with ${code ?? 'unknown status'}`));
    });
  });
}

export async function listIosSimulatorDevices(
  options: ListIosSimulatorDevicesOptions = {},
): Promise<readonly DiscoveredSimulatorDevice[]> {
  const xcrunPath = options.xcrunPath ?? 'xcrun';
  const runCommand = options.runCommand ?? createRunCommand({
    xcrunPath,
    env: options.env ?? process.env,
  });
  const payloadText = await runCommand(xcrunPath, ['simctl', 'list', 'devices', '--json']);
  const parsed = JSON.parse(payloadText) as SimctlListDevicesPayload;
  const devices = parsed.devices && typeof parsed.devices === 'object' ? parsed.devices : {};
  const discoveredDevices: DiscoveredSimulatorDevice[] = [];
  for (const [runtimeId, entries] of Object.entries(devices)) {
    if (!isIosRuntime(runtimeId) || !Array.isArray(entries)) continue;
    for (const device of entries) {
      if (device.isAvailable === false) continue;
      const deviceId = normalizeText(device.udid);
      const displayName = normalizeText(device.name);
      if (!deviceId || !displayName) continue;
      discoveredDevices.push({
        platform: 'ios' as const,
        deviceId,
        displayName,
        state: mapState(device.state),
      });
    }
  }
  return discoveredDevices;
}
