import type { LocalServicePreviewV1 } from '@happier-dev/protocol';

import type { UserMessage } from '@/api/types';

export function buildLocalServicePreviewMessageContent(preview: LocalServicePreviewV1): UserMessage {
  const transcriptText = typeof preview.name === 'string' && preview.name.trim().length > 0
    ? preview.name.trim()
    : `127.0.0.1:${preview.port}`;

  return {
    role: 'user',
    content: {
      type: 'text',
      text: transcriptText,
    },
    meta: {
      sentFrom: 'cli',
      source: 'cli',
      happier: {
        kind: 'local_service_preview.v1',
        payload: preview,
      },
    },
  };
}

export function emitLocalServicePreviewMessage(params: Readonly<{
  preview: LocalServicePreviewV1;
  sendClaudeSessionMessage: (message: unknown, meta?: Record<string, unknown>) => void;
}>): void {
  const content = buildLocalServicePreviewMessageContent(params.preview);

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
