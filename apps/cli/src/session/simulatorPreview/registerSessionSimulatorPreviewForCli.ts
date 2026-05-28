import { randomUUID } from 'node:crypto';

import type {
  AccountSettings,
  SessionStoredMessageContent,
  SimulatorPreviewV1,
} from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import { resolveCliFeatureDecision } from '@/features/featureDecisionService';
import { resolveSessionTransportContext } from '@/session/services/resolveSessionTransportContext';
import { commitSessionStoredMessage } from '@/session/transport/http/sessionsHttp';
import { encryptStoredSessionPayload } from '@/session/transport/encryption/sessionEncryptionContext';

import { buildSimulatorPreviewMessageContent } from './emitSimulatorPreviewMessage';

export type RegisterSessionSimulatorPreviewForCliResult =
  | Readonly<{
      ok: true;
      sessionId: string;
      preview: SimulatorPreviewV1;
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
        | 'message_commit_failed';
      candidates?: string[];
      message?: string;
    }>;

export async function registerSessionSimulatorPreviewForCli(params: Readonly<{
  credentials: Credentials;
  accountSettings: AccountSettings | null;
  idOrPrefix: string;
  simulatorSessionId?: string;
  platform: SimulatorPreviewV1['platform'];
  deviceName: string;
  appName?: string;
  streamUrl: string;
  mode?: SimulatorPreviewV1['mode'];
  owner?: SimulatorPreviewV1['owner'];
  connectionPath?: SimulatorPreviewV1['connectionPath'];
  env?: NodeJS.ProcessEnv;
}>): Promise<RegisterSessionSimulatorPreviewForCliResult> {
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

  const preview: SimulatorPreviewV1 = {
    simulatorSessionId: params.simulatorSessionId ?? `sim_${randomUUID()}`,
    sessionId: sessionTarget.sessionId,
    platform: params.platform,
    deviceName: params.deviceName,
    ...(params.appName ? { appName: params.appName } : {}),
    streamUrl: params.streamUrl,
    mode: params.mode ?? 'ai_control',
    ...(params.owner ? { owner: params.owner } : {}),
    connectionPath: params.connectionPath ?? 'direct',
    registeredAtMs: Date.now(),
  };
  const messageContent = buildSimulatorPreviewMessageContent(preview);
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
      preview,
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
