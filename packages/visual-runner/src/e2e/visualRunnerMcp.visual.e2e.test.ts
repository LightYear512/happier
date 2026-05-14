import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type JsonToolResult = Readonly<{
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}>;

let server: Server | null = null;
let visualUrl = '';
let artifactCwd = '';

async function startVisualFixtureServer(): Promise<string> {
  const fixtureServer = createServer((req, res) => {
    if (req.url === '/api/echo') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, source: 'visual-runner-e2e' }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html>
  <head>
    <title>Visual Runner E2E</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f8fafc; color: #111827; }
      main { width: 640px; margin: 48px auto; padding: 32px; border: 4px solid #0f766e; }
      h1 { font-size: 32px; }
    </style>
  </head>
  <body>
    <main data-testid="visual-runner-e2e-page">
      <h1>VISUAL_RUNNER_E2E_READY</h1>
      <label>
        Message
        <input id="message" value="" />
      </label>
      <button id="action">Inspectable target</button>
      <output id="result"></output>
    </main>
    <script>
      document.querySelector('#action').addEventListener('click', async () => {
        const message = document.querySelector('#message').value;
        console.log('VISUAL_RUNNER_CLICKED:' + message);
        const response = await fetch('/api/echo');
        const payload = await response.json();
        document.querySelector('#result').textContent = message + ':' + payload.source;
      });
    </script>
  </body>
</html>`);
  });

  await new Promise<void>((resolve) => {
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });
  server = fixtureServer;
  const address = fixtureServer.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/`;
}

function parseToolJson(result: JsonToolResult): unknown {
  const text = result.content?.find((part) => part.type === 'text')?.text;
  if (!text) throw new Error(`missing text tool result: ${JSON.stringify(result)}`);
  return JSON.parse(text);
}

function pngSignature(buffer: Buffer): string {
  return buffer.subarray(0, 8).toString('hex');
}

function zipSignature(buffer: Buffer): string {
  return buffer.subarray(0, 2).toString('utf8');
}

describe('visual runner MCP visual e2e', () => {
  beforeAll(async () => {
    visualUrl = await startVisualFixtureServer();
    artifactCwd = await mkdtemp(join(tmpdir(), 'happier-visual-runner-e2e-'));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await rm(artifactCwd, { recursive: true, force: true });
  });

  it('drives a real browser through MCP stdio and writes screenshot plus trace artifacts', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), 'dist/bin/happier-visual-runner.js'), 'mcp'],
      env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    });
    const client = new Client({ name: 'visual-runner-e2e', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'visual.create_session',
        'visual.navigate',
        'visual.type',
        'visual.click',
        'visual.inspect',
        'visual.get_console',
        'visual.get_network',
        'visual.screenshot',
        'visual.get_trace',
        'visual.close_session',
      ]));

      const session = parseToolJson(await client.callTool({
        name: 'visual.create_session',
        arguments: { cwd: artifactCwd },
      }) as JsonToolResult) as { id: string };

      const navigateResult = parseToolJson(await client.callTool({
        name: 'visual.navigate',
        arguments: { sessionId: session.id, url: visualUrl },
      }) as JsonToolResult) as { status: string; title: string };
      expect(navigateResult).toMatchObject({
        status: 'ok',
        title: 'Visual Runner E2E',
      });

      const typeResult = parseToolJson(await client.callTool({
        name: 'visual.type',
        arguments: { sessionId: session.id, target: '#message', text: 'hello-visual' },
      }) as JsonToolResult) as { status: string };
      expect(typeResult.status).toBe('ok');

      const clickResult = parseToolJson(await client.callTool({
        name: 'visual.click',
        arguments: { sessionId: session.id, target: '#action' },
      }) as JsonToolResult) as { status: string };
      expect(clickResult.status).toBe('ok');

      const inspectResult = parseToolJson(await client.callTool({
        name: 'visual.inspect',
        arguments: { sessionId: session.id },
      }) as JsonToolResult) as { text: string };
      expect(inspectResult.text).toContain('hello-visual:visual-runner-e2e');

      const consoleResult = parseToolJson(await client.callTool({
        name: 'visual.get_console',
        arguments: { sessionId: session.id },
      }) as JsonToolResult) as { entries: Array<{ text: string }> };
      expect(consoleResult.entries.map((entry) => entry.text)).toContain('VISUAL_RUNNER_CLICKED:hello-visual');

      const networkResult = parseToolJson(await client.callTool({
        name: 'visual.get_network',
        arguments: { sessionId: session.id },
      }) as JsonToolResult) as { entries: Array<{ url: string; status: number | null }> };
      expect(networkResult.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ url: `${visualUrl}api/echo`, status: 200 }),
      ]));

      const screenshotResult = parseToolJson(await client.callTool({
        name: 'visual.screenshot',
        arguments: { sessionId: session.id },
      }) as JsonToolResult) as {
        status: string;
        artifactPath: string;
        screenshotRef: { kind: string; mimeType: string; sizeBytes: number };
      };

      expect(screenshotResult.status).toBe('ok');
      expect(screenshotResult.screenshotRef).toMatchObject({
        kind: 'screenshot',
        mimeType: 'image/png',
      });
      expect(screenshotResult.screenshotRef.sizeBytes).toBeGreaterThan(1000);

      const screenshotBytes = await readFile(screenshotResult.artifactPath);
      expect(pngSignature(screenshotBytes)).toBe('89504e470d0a1a0a');

      const traceResult = parseToolJson(await client.callTool({
        name: 'visual.get_trace',
        arguments: { sessionId: session.id },
      }) as JsonToolResult) as {
        status: string;
        artifactPath: string;
        traceRef: { kind: string; mimeType: string; sizeBytes: number };
      };
      expect(traceResult.status).toBe('ok');
      expect(traceResult.traceRef).toMatchObject({
        kind: 'trace',
        mimeType: 'application/zip',
      });
      expect(traceResult.traceRef.sizeBytes).toBeGreaterThan(1000);

      const traceBytes = await readFile(traceResult.artifactPath);
      expect(zipSignature(traceBytes)).toBe('PK');

      const dashboardResult = parseToolJson(await client.callTool({
        name: 'visual.get_dashboard',
        arguments: { sessionId: session.id },
      }) as JsonToolResult) as { status: string; dashboardUrl: string };
      expect(dashboardResult.status).toBe('ok');
      expect(dashboardResult.dashboardUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);

      const dashboardHtml = await fetch(dashboardResult.dashboardUrl).then((response) => response.text());
      expect(dashboardHtml).toContain(screenshotResult.screenshotRef.kind);
      expect(dashboardHtml).toContain(traceResult.traceRef.kind);
      expect(dashboardHtml).toContain(screenshotResult.screenshotRef.id);
      expect(dashboardHtml).toContain(traceResult.traceRef.id);

      const screenshotHref = dashboardHtml.match(new RegExp(`href="([^"]*${screenshotResult.screenshotRef.id}\\.png)"`))?.[1];
      expect(screenshotHref).toBeTruthy();
      const screenshotUrl = new URL(screenshotHref ?? '', dashboardResult.dashboardUrl).toString();
      const screenshotResponse = await fetch(screenshotUrl);
      expect(screenshotResponse.status).toBe(200);
      const dashboardScreenshotBytes = Buffer.from(await screenshotResponse.arrayBuffer());
      expect(pngSignature(dashboardScreenshotBytes)).toBe('89504e470d0a1a0a');

      await client.callTool({
        name: 'visual.close_session',
        arguments: { sessionId: session.id },
      });
    } finally {
      await client.close();
    }
  }, 30_000);
});
