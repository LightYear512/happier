import { Socket } from 'node:net';

export type SessionDevPreviewHealthStatus = 'ready' | 'dead';

export type SessionDevPreviewHealthResult = Readonly<{
  status: SessionDevPreviewHealthStatus;
  checkedAtMs: number;
}>;

export async function checkSessionDevPreviewHealth(params: Readonly<{
  port: number;
  timeoutMs?: number;
}>): Promise<SessionDevPreviewHealthResult> {
  const checkedAtMs = Date.now();
  const timeoutMs = typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
    ? Math.max(100, Math.floor(params.timeoutMs))
    : 1_500;

  return await new Promise<SessionDevPreviewHealthResult>((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (status: SessionDevPreviewHealthStatus) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ status, checkedAtMs });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('ready'));
    socket.once('timeout', () => finish('dead'));
    socket.once('error', () => finish('dead'));
    socket.connect(params.port, '127.0.0.1');
  });
}
