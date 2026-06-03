import { randomUUID } from 'node:crypto';

import type { SimulatorPreviewV1 } from '@happier-dev/protocol';

import type { UserMessage } from '@/api/types';

export type SimulatorPreviewRegistrationInput = Readonly<{
  sessionId: string;
  simulatorSessionId?: string;
  platform: SimulatorPreviewV1['platform'];
  deviceName: string;
  appName?: string;
  streamUrl: string;
  mode?: SimulatorPreviewV1['mode'];
  owner?: SimulatorPreviewV1['owner'];
  connectionPath?: SimulatorPreviewV1['connectionPath'];
  controlCapability?: SimulatorPreviewV1['controlCapability'];
  controlUnavailableReason?: SimulatorPreviewV1['controlUnavailableReason'];
  deviceRef?: SimulatorPreviewV1['deviceRef'];
  deviceDisplayName?: SimulatorPreviewV1['deviceDisplayName'];
  relay?: SimulatorPreviewV1['relay'];
  nativeDevSessionId?: SimulatorPreviewV1['nativeDevSessionId'];
  devServices?: SimulatorPreviewV1['devServices'];
}>;

export function buildSimulatorPreviewPayload(input: SimulatorPreviewRegistrationInput): SimulatorPreviewV1 {
  return {
    simulatorSessionId: input.simulatorSessionId ?? `sim_${randomUUID()}`,
    sessionId: input.sessionId,
    platform: input.platform,
    deviceName: input.deviceName,
    ...(input.appName ? { appName: input.appName } : {}),
    streamUrl: input.streamUrl,
    mode: input.mode ?? 'ai_control',
    ...(input.owner ? { owner: input.owner } : {}),
    connectionPath: input.connectionPath ?? 'relay',
    ...(input.controlCapability ? { controlCapability: input.controlCapability } : {}),
    ...(input.controlUnavailableReason ? { controlUnavailableReason: input.controlUnavailableReason } : {}),
    ...(input.deviceRef ? { deviceRef: input.deviceRef } : {}),
    ...(input.deviceDisplayName ? { deviceDisplayName: input.deviceDisplayName } : {}),
    ...(input.relay ? { relay: input.relay } : {}),
    ...(input.nativeDevSessionId ? { nativeDevSessionId: input.nativeDevSessionId } : {}),
    ...(input.devServices ? { devServices: input.devServices } : {}),
    registeredAtMs: Date.now(),
  };
}

export function buildSimulatorPreviewMessageContent(preview: SimulatorPreviewV1): UserMessage {
  return {
    role: 'user',
    content: {
      type: 'text',
      text: `${preview.deviceName} simulator preview`,
    },
    meta: {
      sentFrom: 'cli',
      source: 'cli',
      happier: {
        kind: 'simulator_preview.v1',
        payload: preview,
      },
    },
  };
}

export function emitSimulatorPreviewMessage(params: Readonly<{
  preview: SimulatorPreviewV1;
  sendClaudeSessionMessage: (message: unknown, meta?: Record<string, unknown>) => void;
}>): void {
  const content = buildSimulatorPreviewMessageContent(params.preview);

  params.sendClaudeSessionMessage(
    {
      type: 'user',
      message: {
        content: content.content.text,
      },
    },
    {
      happier: content.meta?.happier,
    },
  );
}
