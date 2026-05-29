import type { SimulatorScreenshotFrame } from './simulatorScreenshotFrame';
import { createIosSimctlFrameCapture } from './createIosSimctlFrameCapture';
import {
  startSimulatorScreenshotMjpegStream,
  type SimulatorScreenshotMjpegStream,
} from './startSimulatorScreenshotMjpegStream';

export type IosScreenshotMjpegStream = SimulatorScreenshotMjpegStream;

export type StartIosScreenshotMjpegStreamOptions = Readonly<{
  host?: string;
  port?: number;
  pollIntervalMs?: number;
  deviceId?: string;
  xcrunPath?: string;
  captureFrame?: () => Promise<Buffer | SimulatorScreenshotFrame>;
}>;

export async function startIosScreenshotMjpegStream(
  options: StartIosScreenshotMjpegStreamOptions = {},
): Promise<IosScreenshotMjpegStream> {
  const captureFrame = options.captureFrame ?? createIosSimctlFrameCapture({
    ...(options.deviceId ? { deviceId: options.deviceId } : {}),
    ...(options.xcrunPath ? { xcrunPath: options.xcrunPath } : {}),
  });
  return await startSimulatorScreenshotMjpegStream({
    ...(options.host ? { host: options.host } : {}),
    ...(typeof options.port === 'number' ? { port: options.port } : {}),
    ...(typeof options.pollIntervalMs === 'number' ? { pollIntervalMs: options.pollIntervalMs } : {}),
    boundary: 'happier-ios-screenshot',
    unavailableMessage: 'No iOS simulator screenshot frame is available yet',
    captureFrame,
  });
}
