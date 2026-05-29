import type { AndroidScreenshotFrame } from './androidScreenshotFrame';
import { createAndroidScreencapFrameCapture } from './createAndroidScreencapFrameCapture';
import {
  startSimulatorScreenshotMjpegStream,
  type SimulatorScreenshotMjpegStream,
} from './startSimulatorScreenshotMjpegStream';

export type AndroidScreenshotMjpegStream = SimulatorScreenshotMjpegStream;

export type StartAndroidScreenshotMjpegStreamOptions = Readonly<{
  host?: string;
  port?: number;
  pollIntervalMs?: number;
  deviceId?: string;
  adbPath?: string;
  captureFrame?: () => Promise<Buffer | AndroidScreenshotFrame>;
}>;

export async function startAndroidScreenshotMjpegStream(
  options: StartAndroidScreenshotMjpegStreamOptions = {},
): Promise<AndroidScreenshotMjpegStream> {
  const captureFrame = options.captureFrame ?? createAndroidScreencapFrameCapture({
    ...(options.deviceId ? { deviceId: options.deviceId } : {}),
    ...(options.adbPath ? { adbPath: options.adbPath } : {}),
  });
  return await startSimulatorScreenshotMjpegStream({
    ...(options.host ? { host: options.host } : {}),
    ...(typeof options.port === 'number' ? { port: options.port } : {}),
    ...(typeof options.pollIntervalMs === 'number' ? { pollIntervalMs: options.pollIntervalMs } : {}),
    boundary: 'happier-android-screenshot',
    unavailableMessage: 'No Android screenshot frame is available yet',
    captureFrame,
  });
}
