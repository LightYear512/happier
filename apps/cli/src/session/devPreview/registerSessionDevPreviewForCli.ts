import { randomUUID } from 'node:crypto';

import type { AccountSettings, LocalServicePreviewV1, SessionStoredMessageContent } from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import { registerDaemonSessionDevPreview } from '@/daemon/controlClient';
import { resolveCliFeatureDecision } from '@/features/featureDecisionService';
import { resolveSessionTransportContext } from '@/session/services/resolveSessionTransportContext';
import { commitSessionStoredMessage } from '@/session/transport/http/sessionsHttp';
import {
  encryptStoredSessionPayload,
  tryDecryptSessionMetadata,
} from '@/session/transport/encryption/sessionEncryptionContext';

import { buildLocalServicePreviewMessageContent } from './emitLocalServicePreviewMessage';

export type RegisterSessionDevPreviewForCliResult =
  | Readonly<{
      ok: true;
      sessionId: string;
      preview: LocalServicePreviewV1;
      localId: string;
      messageId: string;
    }>
  | Readonly<{
      ok: false;
      code:
        | 'feature_disabled'
        | 'session_not_found'
        | 'session_id_ambiguous'
        | 'unsupported'
        | 'missing_machine_id'
        | 'machine_mismatch'
        | 'daemon_unavailable'
        | 'preview_register_failed'
        | 'message_commit_failed';
      candidates?: string[];
      message?: string;
    }>;

type RegisterSessionDevPreviewForCliErrorCode = Extract<
  RegisterSessionDevPreviewForCliResult,
  { ok: false }
>['code'];

function readSessionMachineId(params: Readonly<{
  credentials: Credentials;
  rawSession: Readonly<{ metadata?: unknown; dataEncryptionKey?: unknown; encryptionMode?: unknown }>;
}>): string {
  const metadata = tryDecryptSessionMetadata({
    credentials: params.credentials,
    rawSession: params.rawSession,
  });
  const machineId = typeof metadata?.machineId === 'string' ? metadata.machineId.trim() : '';
  return machineId;
}

function normalizeDaemonErrorCode(errorCode: unknown): RegisterSessionDevPreviewForCliErrorCode {
  if (errorCode === 'machine_mismatch') return 'machine_mismatch';
  if (errorCode === 'preview_register_failed') return 'preview_register_failed';
  if (errorCode === 'missing_machine_id') return 'missing_machine_id';
  return 'daemon_unavailable';
}

function resolvePreviewPort(params: Readonly<{ port?: number; url?: string }>): number | undefined {
  if (typeof params.port === 'number') return params.port;
  if (typeof params.url !== 'string' || params.url.trim().length === 0) return undefined;
  try {
    const parsed = new URL(params.url.trim());
    const port = Number(parsed.port || (parsed.protocol === 'http:' ? '80' : '443'));
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
  } catch {
    return undefined;
  }
}

export async function registerSessionDevPreviewForCli(params: Readonly<{
  credentials: Credentials;
  accountSettings: AccountSettings | null;
  idOrPrefix: string;
  port?: number;
  url?: string;
  name?: string;
  framework?: string;
  healthPath?: string;
  rewriteUrls?: boolean;
  env?: NodeJS.ProcessEnv;
}>): Promise<RegisterSessionDevPreviewForCliResult> {
  const decision = resolveCliFeatureDecision({
    featureId: 'sessions.devPreview',
    env: params.env ?? process.env,
    accountSettings: params.accountSettings,
  });
  if (decision.state !== 'enabled') {
    return {
      ok: false,
      code: 'feature_disabled',
      message: decision.blockerCode,
    };
  }

  const sessionTarget = await resolveSessionTransportContext({
    credentials: params.credentials,
    idOrPrefix: params.idOrPrefix,
  });
  if (!sessionTarget.ok) {
    return {
      ok: false,
      code: sessionTarget.code,
      ...(sessionTarget.candidates ? { candidates: sessionTarget.candidates } : {}),
    };
  }

  const machineId = readSessionMachineId({
    credentials: params.credentials,
    rawSession: sessionTarget.rawSession,
  });
  if (!machineId) {
    return { ok: false, code: 'missing_machine_id' };
  }

  const port = resolvePreviewPort(params);
  const registered = await registerDaemonSessionDevPreview({
    sessionId: sessionTarget.sessionId,
    expectedMachineId: machineId,
    ...(typeof port === 'number' ? { port } : {}),
    ...(params.url ? { url: params.url } : {}),
    ...(params.name ? { name: params.name } : {}),
    ...(params.framework ? { framework: params.framework } : {}),
    ...(params.healthPath ? { healthPath: params.healthPath } : {}),
    ...(typeof params.rewriteUrls === 'boolean' ? { rewriteUrls: params.rewriteUrls } : {}),
  });
  if (!('success' in registered) || registered.success !== true) {
    return {
      ok: false,
      code: normalizeDaemonErrorCode('errorCode' in registered ? registered.errorCode : undefined),
      ...(typeof registered.error === 'string' ? { message: registered.error } : {}),
    };
  }

  if (registered.preview.machineId !== machineId) {
    return {
      ok: false,
      code: 'machine_mismatch',
      message: 'preview_registered_on_different_machine',
    };
  }

  const messageContent = buildLocalServicePreviewMessageContent(registered.preview);
  const storedContent: SessionStoredMessageContent = sessionTarget.mode === 'plain'
    ? { t: 'plain', v: messageContent }
    : {
        t: 'encrypted',
        c: encryptStoredSessionPayload({
          mode: sessionTarget.mode,
          ctx: sessionTarget.ctx,
          payload: messageContent,
        }),
      };
  const localId = randomUUID();

  try {
    const committed = await commitSessionStoredMessage({
      token: params.credentials.token,
      sessionId: sessionTarget.sessionId,
      content: storedContent,
      localId,
    });
    return {
      ok: true,
      sessionId: sessionTarget.sessionId,
      preview: registered.preview,
      localId,
      messageId: committed.messageId,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'message_commit_failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
