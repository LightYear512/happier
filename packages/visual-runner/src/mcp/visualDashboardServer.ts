import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { basename, extname, join } from 'node:path';

export type VisualDashboardServer = Readonly<{
  registerSession: (params: Readonly<{
    sessionId: string;
    artifactDir: string;
  }>) => Promise<string>;
}>;

type DashboardSession = Readonly<{
  sessionId: string;
  artifactDir: string;
}>;

export function createVisualDashboardServer(): VisualDashboardServer {
  const sessionsByToken = new Map<string, DashboardSession>();
  const tokensBySessionId = new Map<string, string>();
  let serverPromise: Promise<{ server: Server; port: number }> | null = null;

  return {
    async registerSession(params) {
      const { port } = await ensureServer();
      const token = tokensBySessionId.get(params.sessionId) ?? randomUUID();
      tokensBySessionId.set(params.sessionId, token);
      sessionsByToken.set(token, {
        sessionId: params.sessionId,
        artifactDir: params.artifactDir,
      });
      return `http://127.0.0.1:${port}/session/${token}/`;
    },
  };

  function ensureServer(): Promise<{ server: Server; port: number }> {
    if (serverPromise) return serverPromise;

    serverPromise = new Promise((resolve) => {
      const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const [, route, token, subroute, fileName] = url.pathname.split('/');
        if (route !== 'session' || !token) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('not found');
          return;
        }

        const session = sessionsByToken.get(token);
        if (!session) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('unknown visual session');
          return;
        }

        if (subroute === 'artifact' && fileName) {
          await serveArtifactFile({
            artifactDir: session.artifactDir,
            fileName,
            res,
          });
          return;
        }

        const html = await renderDashboardHtml({ session, token });
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(html);
      });

      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve({ server, port: address.port });
      });
    });

    return serverPromise;
  }
}

async function renderDashboardHtml(params: Readonly<{
  session: DashboardSession;
  token: string;
}>): Promise<string> {
  const { session, token } = params;
  const artifacts = await listDashboardArtifacts(session.artifactDir);
  const rows = artifacts.map((artifact) => [
    '<tr>',
    `<td>${escapeHtml(artifact.id)}</td>`,
    `<td>${escapeHtml(artifact.kind)}</td>`,
    `<td>${artifact.sizeBytes}</td>`,
    `<td><a href="/session/${encodeURIComponent(token)}/artifact/${encodeURIComponent(artifact.fileName)}">${escapeHtml(artifact.fileName)}</a></td>`,
    '</tr>',
  ].join('')).join('');

  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>Visual Runner ${escapeHtml(session.sessionId)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;margin:32px;color:#111827}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d1d5db;padding:8px;text-align:left}</style>',
    '</head>',
    '<body>',
    `<h1>Visual Runner ${escapeHtml(session.sessionId)}</h1>`,
    '<table>',
    '<thead><tr><th>Artifact</th><th>Kind</th><th>Bytes</th><th>File</th></tr></thead>',
    `<tbody>${rows}</tbody>`,
    '</table>',
    '</body>',
    '</html>',
  ].join('');
}

async function serveArtifactFile(params: Readonly<{
  artifactDir: string;
  fileName: string;
  res: ServerResponse;
}>): Promise<void> {
  if (params.fileName !== basename(params.fileName)) {
    params.res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    params.res.end('invalid artifact path');
    return;
  }

  const artifactPath = join(params.artifactDir, params.fileName);
  const fileStat = await stat(artifactPath).catch(() => null);
  if (!fileStat?.isFile()) {
    params.res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    params.res.end('artifact not found');
    return;
  }

  const body = await readFile(artifactPath);
  params.res.writeHead(200, {
    'content-type': resolveArtifactContentType(params.fileName),
    'cache-control': 'no-store',
  });
  params.res.end(body);
}

async function listDashboardArtifacts(artifactDir: string): Promise<Array<Readonly<{
  id: string;
  kind: string;
  fileName: string;
  sizeBytes: number;
}>>> {
  const fileNames = await readdir(artifactDir).catch(() => []);
  const artifacts = [];

  for (const fileName of fileNames.sort()) {
    const path = join(artifactDir, fileName);
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat?.isFile()) continue;
    artifacts.push({
      id: basename(fileName, extname(fileName)),
      kind: inferArtifactKind(fileName),
      fileName,
      sizeBytes: fileStat.size,
    });
  }

  return artifacts;
}

function inferArtifactKind(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.png') return 'screenshot';
  if (extension === '.zip') return 'trace';
  return 'artifact';
}

function resolveArtifactContentType(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.zip') return 'application/zip';
  return 'application/octet-stream';
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
