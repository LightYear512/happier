import { afterEach, describe, expect, it, vi } from 'vitest';

import { startAndroidScreenshotMjpegStream } from './startAndroidScreenshotMjpegStream';

const openStreams: Array<{ close: () => Promise<void> }> = [];

async function readSomeBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('missing response body');
  const chunks: Buffer[] = [];
  while (Buffer.concat(chunks).length < 96) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(Buffer.from(next.value));
  }
  await reader.cancel();
  return Buffer.concat(chunks);
}

describe('startAndroidScreenshotMjpegStream', () => {
  afterEach(async () => {
    await Promise.all(openStreams.splice(0).map((stream) => stream.close()));
  });

  it('serves polled Android screenshots as an MJPEG stream and latest JPEG frame', async () => {
    const captureFrame = vi
      .fn()
      .mockResolvedValueOnce(Buffer.from('jpeg-frame-one'))
      .mockResolvedValue(Buffer.from('jpeg-frame-two'));

    const stream = await startAndroidScreenshotMjpegStream({
      host: '127.0.0.1',
      port: 0,
      pollIntervalMs: 10,
      captureFrame,
    });
    openStreams.push(stream);

    expect(stream.streamUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/stream\.mjpeg$/);
    expect(stream.frameUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/frame\.jpg$/);

    const frameResponse = await fetch(stream.frameUrl);
    expect(frameResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await frameResponse.arrayBuffer()).toString('utf8')).toBe('jpeg-frame-one');

    const streamBytes = await readSomeBytes(stream.streamUrl);
    const streamText = streamBytes.toString('latin1');
    expect(streamText).toContain('Content-Type: image/jpeg');
    expect(streamText).toContain('jpeg-frame-');
    expect(captureFrame).toHaveBeenCalled();
  });

  it('serves Android PNG screencap frames without requiring JPEG conversion', async () => {
    const captureFrame = vi.fn().mockResolvedValue({
      body: Buffer.from('png-frame-one'),
      contentType: 'image/png' as const,
    });

    const stream = await startAndroidScreenshotMjpegStream({
      host: '127.0.0.1',
      port: 0,
      pollIntervalMs: 10,
      captureFrame,
    });
    openStreams.push(stream);

    const frameResponse = await fetch(stream.frameUrl);
    expect(frameResponse.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await frameResponse.arrayBuffer()).toString('utf8')).toBe('png-frame-one');

    const streamBytes = await readSomeBytes(stream.streamUrl);
    const streamText = streamBytes.toString('latin1');
    expect(streamText).toContain('Content-Type: image/png');
    expect(streamText).toContain('png-frame-one');
  });
});
