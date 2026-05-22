import chalk from 'chalk';
import type { AccountSettings } from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import { hasFlag, readFlagValue, readIntFlagValue } from '@/cli/commands/shared/argvFlags';
import { wantsJson, printJsonEnvelope } from '@/cli/output/jsonEnvelope';
import { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import { registerSessionDevPreviewForCli } from '@/session/devPreview/registerSessionDevPreviewForCli';

async function loadAccountSettings(credentials: Credentials): Promise<AccountSettings | null> {
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

export async function cmdSessionPreviewRegister(
  argv: string[],
  deps: Readonly<{ readCredentialsFn: () => Promise<Credentials | null> }>,
): Promise<void> {
  const json = wantsJson(argv);
  const registerSubcommand = String(argv[1] ?? '').trim();
  const idOrPrefix = String(argv[2] ?? '').trim();
  const port = readIntFlagValue(argv, '--port');
  const url = readFlagValue(argv, '--url') ?? undefined;
  const name = readFlagValue(argv, '--name') ?? undefined;
  const framework = readFlagValue(argv, '--framework') ?? undefined;
  const healthPath = readFlagValue(argv, '--health-path') ?? undefined;
  const rewriteUrls = hasFlag(argv, '--no-rewrite-urls')
    ? false
    : hasFlag(argv, '--rewrite-urls')
      ? true
      : undefined;

  if (registerSubcommand !== 'register' || !idOrPrefix || ((!port || port < 1 || port > 65535) && !url)) {
    throw new Error('Usage: happier session preview register <session-id-or-prefix> (--url <url> | --port <port>) [--name <name>] [--framework <id>] [--health-path <path>] [--no-rewrite-urls] [--json]');
  }

  const credentials = await deps.readCredentialsFn();
  if (!credentials) {
    if (json) {
      printJsonEnvelope({ ok: false, kind: 'session_preview_register', error: { code: 'not_authenticated' } });
      return;
    }
    console.error(chalk.red('Error:'), 'Not authenticated. Run "happier auth login" first.');
    process.exit(1);
  }

  const result = await registerSessionDevPreviewForCli({
    credentials,
    accountSettings: await loadAccountSettings(credentials),
    idOrPrefix,
    ...(typeof port === 'number' ? { port } : {}),
    ...(url ? { url } : {}),
    ...(name ? { name } : {}),
    ...(framework ? { framework } : {}),
    ...(healthPath ? { healthPath } : {}),
    ...(typeof rewriteUrls === 'boolean' ? { rewriteUrls } : {}),
  });

  if (!result.ok) {
    if (json) {
      printJsonEnvelope({
        ok: false,
        kind: 'session_preview_register',
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
      kind: 'session_preview_register',
      data: {
        sessionId: result.sessionId,
        resourceId: result.preview.resourceId,
        routeKey: result.preview.preview.routeKey,
        port: result.preview.port,
        ...(result.preview.url ? { url: result.preview.url } : {}),
        health: result.preview.health,
        localId: result.localId,
        messageId: result.messageId,
      },
    });
    return;
  }

  console.log(chalk.green('✓'), `preview registered for ${result.sessionId}`);
  console.log(JSON.stringify({
    resourceId: result.preview.resourceId,
    routeKey: result.preview.preview.routeKey,
    port: result.preview.port,
    ...(result.preview.url ? { url: result.preview.url } : {}),
    health: result.preview.health,
  }, null, 2));
}
