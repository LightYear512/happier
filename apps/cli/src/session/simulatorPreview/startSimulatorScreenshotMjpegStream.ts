import { createServer, type Server, type ServerResponse } from 'node:http';

import { normalizeSimulatorScreenshotFrame, type SimulatorScreenshotFrame } from './simulatorScreenshotFrame';

export type SimulatorScreenshotMjpegStream = Readonly<{
  host: string;
  port: number;
  frameUrl: string;
  streamUrl: string;
  close: () => Promise<void>;
}>;

export type StartSimulatorScreenshotMjpegStreamOptions = Readonly<{
  host?: string;
  port?: number;
  pollIntervalMs?: number;
  boundary: string;
  unavailableMessage: string;
  captureFrame: () => Promise<Buffer | SimulatorScreenshotFrame>;
}>;

type StreamClient = Readonly<{
  id: number;
  response: ServerResponse;
}>;

function writeMultipartFrame(response: ServerResponse, boundary: string, frame: SimulatorScreenshotFrame): void {
  response.write(`--${boundary}\r\n`);
  response.write(`Content-Type: ${frame.contentType}\r\n`);
  response.write(`Content-Length: ${frame.body.length}\r\n\r\n`);
  response.write(frame.body);
  response.write('\r\n');
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve MJPEG stream server address'));
        return;
      }
      resolve(address.port);
    });
  });
}

export async function startSimulatorScreenshotMjpegStream(
  options: StartSimulatorScreenshotMjpegStreamOptions,
): Promise<SimulatorScreenshotMjpegStream> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 0;
  const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 250);
  const clients = new Map<number, StreamClient>();
  let nextClientId = 1;
  let latestFrame: SimulatorScreenshotFrame | null = null;
  let latestError: Error | null = null;
  let closed = false;
  let captureInFlight = false;

  const broadcastFrame = (frame: SimulatorScreenshotFrame) => {
    for (const client of clients.values()) {
      writeMultipartFrame(client.response, options.boundary, frame);
    }
  };

  const poll = async () => {
    if (closed || captureInFlight) return;
    captureInFlight = true;
    try {
      const frame = normalizeSimulatorScreenshotFrame(await options.captureFrame());
      latestFrame = frame;
      latestError = null;
      broadcastFrame(frame);
    } catch (error) {
      latestError = error instanceof Error ? error : new Error(String(error));
    } finally {
      captureInFlight = false;
    }
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${requestedPort}`}`);
    if (req.method === 'GET' && url.pathname === '/frame.jpg') {
      if (!latestFrame) {
        await poll();
      }
      if (!latestFrame) {
        res.statusCode = 503;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(latestError?.message ?? options.unavailableMessage);
        return;
      }
      res.statusCode = 200;
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', latestFrame.contentType);
      res.end(latestFrame.body);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/stream.mjpeg') {
      const id = nextClientId++;
      res.statusCode = 200;
      res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
      res.setHeader('connection', 'close');
      res.setHeader('content-type', `multipart/x-mixed-replace; boundary=${options.boundary}`);
      clients.set(id, { id, response: res });
      if (latestFrame) {
        writeMultipartFrame(res, options.boundary, latestFrame);
      } else {
        void poll();
      }
      req.once('close', () => {
        clients.delete(id);
      });
      return;
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Not found');
  });

  const actualPort = await listen(server, host, requestedPort);
  await poll();
  const timer = setInterval(() => {
    void poll();
  }, pollIntervalMs);
  timer.unref?.();

  return {
    host,
    port: actualPort,
    frameUrl: `http://${host}:${actualPort}/frame.jpg`,
    streamUrl: `http://${host}:${actualPort}/stream.mjpeg`,
    close: async () => {
      closed = true;
      clearInterval(timer);
      for (const client of clients.values()) {
        client.response.end();
      }
      clients.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
