export type AndroidScreenshotFrame = Readonly<{
  body: Buffer;
  contentType: 'image/jpeg' | 'image/png';
}>;

export function normalizeAndroidScreenshotFrame(frame: Buffer | AndroidScreenshotFrame): AndroidScreenshotFrame {
  if (Buffer.isBuffer(frame)) {
    return {
      body: frame,
      contentType: 'image/jpeg',
    };
  }
  return frame;
}
