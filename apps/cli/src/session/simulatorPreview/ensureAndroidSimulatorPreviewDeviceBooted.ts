import { spawn } from 'node:child_process';

import { parseAndroidEmulatorAvdName, parseBootedAndroidAdbSerials } from './androidSimulatorDeviceParsing';

export type EnsureAndroidSimulatorPreviewDeviceBootedOptions = Readonly<{
  deviceId: string;
  adbPath?: string;
  emulatorPath?: string;
  env?: NodeJS.ProcessEnv;
  runCommand?: (command: string, args: readonly string[]) => Promise<string>;
  spawnProcess?: (command: string, args: readonly string[]) => void;
  sleepMs?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}>;

const AVD_DEVICE_ID_PREFIX = 'avd:';
const DEFAULT_BOOT_TIMEOUT_MS = 120_000;
const DEFAULT_BOOT_POLL_INTERVAL_MS = 1_000;

function normalizeText(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createRunCommand(options: Readonly<{
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
      reject(new Error(message || `${command} exited with ${code ?? 'unknown status'}`));
    });
  });
}

function createSpawnProcess(options: Readonly<{
  env: NodeJS.ProcessEnv;
}>): (command: string, args: readonly string[]) => void {
  return (command, args) => {
    const child = spawn(command, [...args], {
      detached: true,
      env: options.env,
      stdio: 'ignore',
    });
    child.unref();
  };
}

async function defaultSleepMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
  });
}

async function findBootedSerialForAvd(input: Readonly<{
  adbPath: string;
  avdName: string;
  runCommand: (command: string, args: readonly string[]) => Promise<string>;
}>): Promise<string | null> {
  const serials = parseBootedAndroidAdbSerials(await input.runCommand(input.adbPath, ['devices', '-l']).catch(() => ''));
  for (const serial of serials) {
    const avdName = parseAndroidEmulatorAvdName(await input.runCommand(input.adbPath, ['-s', serial, 'emu', 'avd', 'name']).catch(() => ''));
    if (avdName === input.avdName) {
      return serial;
    }
  }
  return null;
}

export async function ensureAndroidSimulatorPreviewDeviceBooted(
  options: EnsureAndroidSimulatorPreviewDeviceBootedOptions,
): Promise<Readonly<{ deviceId: string }>> {
  const deviceId = normalizeText(options.deviceId);
  if (!deviceId) {
    throw new Error('android_simulator_device_not_found');
  }
  if (!deviceId.startsWith(AVD_DEVICE_ID_PREFIX)) {
    return { deviceId };
  }

  const avdName = deviceId.slice(AVD_DEVICE_ID_PREFIX.length).trim();
  if (!avdName) {
    throw new Error('android_simulator_device_not_found');
  }

  const adbPath = options.adbPath ?? 'adb';
  const emulatorPath = options.emulatorPath ?? 'emulator';
  const runCommand = options.runCommand ?? createRunCommand({ env: options.env ?? process.env });
  const spawnProcess = options.spawnProcess ?? createSpawnProcess({ env: options.env ?? process.env });
  const sleepMs = options.sleepMs ?? defaultSleepMs;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? DEFAULT_BOOT_POLL_INTERVAL_MS);

  const existingSerial = await findBootedSerialForAvd({ adbPath, avdName, runCommand });
  if (existingSerial) {
    return { deviceId: existingSerial };
  }

  spawnProcess(emulatorPath, [
    `@${avdName}`,
    '-no-window',
    '-no-audio',
    '-no-boot-anim',
  ]);

  const deadlineMs = Date.now() + timeoutMs;
  while (Date.now() <= deadlineMs) {
    const serial = await findBootedSerialForAvd({ adbPath, avdName, runCommand });
    if (serial) {
      const bootCompleted = normalizeText(await runCommand(adbPath, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).catch(() => ''));
      if (bootCompleted === '1') {
        return { deviceId: serial };
      }
    }
    await sleepMs(pollIntervalMs);
  }

  throw new Error(`android_simulator_boot_timeout:${avdName}`);
}
