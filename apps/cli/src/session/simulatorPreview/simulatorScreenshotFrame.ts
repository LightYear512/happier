export type SimulatorScreenshotFrame = Readonly<{
  body: Buffer;
  contentType: 'image/jpeg' | 'image/png';
}>;

export function normalizeSimulatorScreenshotFrame(frame: Buffer | SimulatorScreenshotFrame): SimulatorScreenshotFrame {
  if (Buffer.isBuffer(frame)) {
    return {
      body: frame,
      contentType: 'image/jpeg',
    };
  }
  return frame;
}
