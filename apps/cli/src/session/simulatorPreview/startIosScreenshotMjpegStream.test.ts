import { afterEach, describe, expect, it, vi } from 'vitest';

import { startIosScreenshotMjpegStream } from './startIosScreenshotMjpegStream';

const openStreams: Array<{ close: () => Promise<void> }> = [];

async function readSomeBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('missing response body');
  const next = await reader.read();
  await reader.cancel();
  return next.done ? Buffer.alloc(0) : Buffer.from(next.value);
}

describe('startIosScreenshotMjpegStream', () => {
  afterEach(async () => {
    await Promise.all(openStreams.splice(0).map((stream) => stream.close()));
  });

  it('serves polled iOS simulator screenshots as an MJPEG stream and latest JPEG frame', async () => {
    const captureFrame = vi
      .fn()
      .mockResolvedValueOnce(Buffer.from('ios-jpeg-frame-one'))
      .mockResolvedValue(Buffer.from('ios-jpeg-frame-two'));

    const stream = await startIosScreenshotMjpegStream({
      host: '127.0.0.1',
      port: 0,
      pollIntervalMs: 60_000,
      captureFrame,
    });
    openStreams.push(stream);

    expect(stream.streamUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/stream\.mjpeg$/);
    expect(stream.frameUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/frame\.jpg$/);

    const frameResponse = await fetch(stream.frameUrl);
    expect(frameResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await frameResponse.arrayBuffer()).toString('utf8')).toBe('ios-jpeg-frame-one');

    const streamBytes = await readSomeBytes(stream.streamUrl);
    const streamText = streamBytes.toString('latin1');
    expect(streamText).toContain('Content-Type: image/jpeg');
    expect(streamText).toContain('ios-jpeg-frame-');
    expect(captureFrame).toHaveBeenCalled();
  });
});
