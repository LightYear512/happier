import { spawn } from 'node:child_process';

export type IosSimulatorPreviewDevice = Readonly<{
  deviceId: string;
  deviceName: string;
}>;

export type ResolveIosSimulatorPreviewDeviceOptions = Readonly<{
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

function readDevices(payloadText: string): readonly SimctlDevice[] {
  const parsed = JSON.parse(payloadText) as SimctlListDevicesPayload;
  const devices = parsed.devices && typeof parsed.devices === 'object' ? parsed.devices : {};
  return Object.entries(devices)
    .filter(([runtimeId]) => isIosRuntime(runtimeId))
    .flatMap(([, entries]) => Array.isArray(entries) ? entries : []);
}

function toPreviewDevice(device: SimctlDevice): IosSimulatorPreviewDevice | null {
  const deviceId = normalizeText(device.udid);
  const deviceName = normalizeText(device.name);
  if (!deviceId || !deviceName) return null;
  return { deviceId, deviceName };
}

function selectBootedDevice(payloadText: string): IosSimulatorPreviewDevice | null {
  for (const device of readDevices(payloadText)) {
    if (normalizeText(device.state).toLowerCase() !== 'booted') continue;
    const previewDevice = toPreviewDevice(device);
    if (previewDevice) return previewDevice;
  }
  return null;
}

function selectAvailableDevice(payloadText: string): IosSimulatorPreviewDevice | null {
  for (const device of readDevices(payloadText)) {
    if (device.isAvailable === false) continue;
    const previewDevice = toPreviewDevice(device);
    if (previewDevice) return previewDevice;
  }
  return null;
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
      reject(new Error(message || `${options.xcrunPath} exited with ${code ?? 'unknown status'}`));
    });
  });
}

export async function resolveIosSimulatorPreviewDevice(
  options: ResolveIosSimulatorPreviewDeviceOptions = {},
): Promise<IosSimulatorPreviewDevice> {
  const xcrunPath = options.xcrunPath ?? 'xcrun';
  const runCommand = options.runCommand ?? createRunCommand({
    xcrunPath,
    env: options.env ?? process.env,
  });

  const booted = selectBootedDevice(await runCommand(xcrunPath, ['simctl', 'list', 'devices', 'booted', '--json']));
  if (booted) return booted;

  const available = selectAvailableDevice(await runCommand(xcrunPath, ['simctl', 'list', 'devices', 'available', '--json']));
  if (!available) {
    throw new Error('ios_simulator_device_not_found');
  }
  await runCommand(xcrunPath, ['simctl', 'boot', available.deviceId]);
  await runCommand(xcrunPath, ['simctl', 'bootstatus', available.deviceId, '-b']);
  return available;
}
