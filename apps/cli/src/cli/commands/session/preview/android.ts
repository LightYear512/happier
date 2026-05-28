import chalk from 'chalk';
import type { AccountSettings } from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import { readFlagValue, readIntFlagValue } from '@/cli/commands/shared/argvFlags';
import { wantsJson, printJsonEnvelope } from '@/cli/output/jsonEnvelope';
import { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import {
  startAndroidScreenshotMjpegStream,
  type AndroidScreenshotMjpegStream,
} from '@/session/simulatorPreview/startAndroidScreenshotMjpegStream';
import {
  registerSessionSimulatorPreviewForCli,
  type RegisterSessionSimulatorPreviewForCliResult,
} from '@/session/simulatorPreview/registerSessionSimulatorPreviewForCli';

async function defaultLoadAccountSettings(credentials: Credentials): Promise<AccountSettings | null> {
  try {
    const context = await bootstrapAccountSettingsContext({
      credentials,
      mode: 'fast',
      refresh: 'auto',
    });
    return context.settings;
  } catch {
    return null;
  }
}

function defaultHoldOpen(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

export async function cmdSessionPreviewAndroid(
  argv: string[],
  deps: Readonly<{
    readCredentialsFn: () => Promise<Credentials | null>;
    loadAccountSettings?: (credentials: Credentials) => Promise<AccountSettings | null>;
    startAndroidStream?: typeof startAndroidScreenshotMjpegStream;
    registerSimulatorPreview?: typeof registerSessionSimulatorPreviewForCli;
    holdOpen?: () => Promise<void>;
  }>,
): Promise<void> {
  const json = wantsJson(argv);
  const previewSubcommand = String(argv[1] ?? '').trim();
  const idOrPrefix = String(argv[2] ?? '').trim();
  const deviceId = readFlagValue(argv, '--device-id') ?? readFlagValue(argv, '--device') ?? undefined;
  const port = readIntFlagValue(argv, '--port');
  const pollIntervalMs = readIntFlagValue(argv, '--poll-ms') ?? undefined;
  const deviceName = readFlagValue(argv, '--device-name') ?? 'Android Emulator';
  const appName = readFlagValue(argv, '--app-name') ?? undefined;

  if (previewSubcommand !== 'android' || !idOrPrefix) {
    throw new Error('Usage: happier session preview android <session-id-or-prefix> [--device-id <adb-serial>] [--port <port>] [--poll-ms <ms>] [--device-name <name>] [--app-name <name>] [--json]');
  }
  if (typeof port === 'number' && (port < 1 || port > 65535)) {
    throw new Error('Invalid --port; expected 1..65535');
  }

  const credentials = await deps.readCredentialsFn();
  if (!credentials) {
    if (json) {
      printJsonEnvelope({ ok: false, kind: 'session_preview_android', error: { code: 'not_authenticated' } });
      return;
    }
    console.error(chalk.red('Error:'), 'Not authenticated. Run "happier auth login" first.');
    process.exit(1);
  }

  const stream = await (deps.startAndroidStream ?? startAndroidScreenshotMjpegStream)({
    host: '127.0.0.1',
    ...(typeof port === 'number' ? { port } : {}),
    ...(typeof pollIntervalMs === 'number' ? { pollIntervalMs } : {}),
    ...(deviceId ? { deviceId } : {}),
  });

  let result: RegisterSessionSimulatorPreviewForCliResult;
  try {
    result = await (deps.registerSimulatorPreview ?? registerSessionSimulatorPreviewForCli)({
      credentials,
      accountSettings: await (deps.loadAccountSettings ?? defaultLoadAccountSettings)(credentials),
      idOrPrefix,
      platform: 'android',
      deviceName,
      ...(appName ? { appName } : {}),
      streamUrl: stream.streamUrl,
      mode: 'ai_control',
      owner: 'ai',
      connectionPath: 'direct',
    });
  } catch (error) {
    await stream.close();
    throw error;
  }

  if (!result.ok) {
    await stream.close();
    if (json) {
      printJsonEnvelope({
        ok: false,
        kind: 'session_preview_android',
        error: {
          code: result.code,
          ...(result.message ? { message: result.message } : {}),
          ...(result.candidates ? { candidates: result.candidates } : {}),
        },
      });
      return;
    }
    throw new Error(result.message || result.code);
  }

  if (json) {
    printJsonEnvelope({
      ok: true,
      kind: 'session_preview_android',
      data: {
        sessionId: result.sessionId,
        simulatorSessionId: result.preview.simulatorSessionId,
        streamUrl: stream.streamUrl,
        frameUrl: stream.frameUrl,
        port: stream.port,
        messageId: result.messageId,
      },
    });
  } else {
    console.log(chalk.green('✓'), `Android simulator preview registered for ${result.sessionId}`);
    console.log(JSON.stringify({
      simulatorSessionId: result.preview.simulatorSessionId,
      streamUrl: stream.streamUrl,
      frameUrl: stream.frameUrl,
      port: stream.port,
    }, null, 2));
    console.log('Streaming Android screenshots. Press Ctrl+C to stop.');
  }

  try {
    await (deps.holdOpen ?? defaultHoldOpen)();
  } finally {
    await stream.close();
  }
}

export type { AndroidScreenshotMjpegStream };
