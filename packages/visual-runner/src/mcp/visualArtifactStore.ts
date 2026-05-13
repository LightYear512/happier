import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { VisualArtifactRefSchema, type VisualArtifactKind, type VisualArtifactRef, type VisualSession } from '../contract.js';

const VISUAL_ARTIFACT_TTL_MS = 60 * 60 * 1000;
const VISUAL_ARTIFACT_MAX_BYTES = 100 * 1024 * 1024;

export type VisualArtifactStore = Readonly<{
  artifactDir: string;
  writeArtifact: (params: Readonly<{
    kind: VisualArtifactKind;
    mimeType: string;
    extension: string;
    write: (path: string) => Promise<void>;
  }>) => Promise<Readonly<{
    artifactPath: string;
    artifactRef: VisualArtifactRef;
  }>>;
}>;

type ArtifactFileEntry = Readonly<{
  path: string;
  modifiedMs: number;
  sizeBytes: number;
}>;

export function createVisualArtifactStore(params: Readonly<{
  cwd: string;
  sessionId: string;
  ttlMs: number;
  maxBytes: number;
  now: () => Date;
  generateArtifactId: () => string;
}>): VisualArtifactStore {
  const artifactDir = join(params.cwd, '.happier', 'visual-runner', params.sessionId);

  return {
    artifactDir,
    async writeArtifact(writeParams) {
      await mkdir(artifactDir, { recursive: true });
      await pruneArtifactDir({
        artifactDir,
        nowMs: params.now().getTime(),
        ttlMs: params.ttlMs,
        maxBytes: params.maxBytes,
      });

      const createdAt = params.now();
      const artifactId = params.generateArtifactId();
      const artifactPath = join(artifactDir, `${artifactId}.${writeParams.extension}`);
      await writeParams.write(artifactPath);

      const artifactStat = await stat(artifactPath);
      await pruneArtifactDir({
        artifactDir,
        nowMs: params.now().getTime(),
        ttlMs: params.ttlMs,
        maxBytes: params.maxBytes,
      });

      const artifactStillExists = await stat(artifactPath).then(() => true, () => false);
      if (!artifactStillExists) {
        throw new Error(`artifact ${basename(artifactPath)} exceeded artifact quota`);
      }

      const artifactRef = VisualArtifactRefSchema.parse({
        id: artifactId,
        kind: writeParams.kind,
        mimeType: writeParams.mimeType,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + params.ttlMs).toISOString(),
        sizeBytes: artifactStat.size,
      });

      return { artifactPath, artifactRef };
    },
  };
}

export function createSessionArtifactStore(
  session: VisualSession,
  params: Readonly<{
    now: () => Date;
  }>,
): VisualArtifactStore {
  return createVisualArtifactStore({
    cwd: session.cwd,
    sessionId: session.id,
    ttlMs: VISUAL_ARTIFACT_TTL_MS,
    maxBytes: VISUAL_ARTIFACT_MAX_BYTES,
    now: params.now,
    generateArtifactId: () => `visual-artifact-${randomUUID()}`,
  });
}

async function pruneArtifactDir(params: Readonly<{
  artifactDir: string;
  nowMs: number;
  ttlMs: number;
  maxBytes: number;
}>): Promise<void> {
  const entries = await listArtifactFiles(params.artifactDir);
  const freshEntries: ArtifactFileEntry[] = [];

  for (const entry of entries) {
    if (params.nowMs - entry.modifiedMs > params.ttlMs) {
      await rm(entry.path, { force: true });
    } else {
      freshEntries.push(entry);
    }
  }

  let totalBytes = freshEntries.reduce((total, entry) => total + entry.sizeBytes, 0);
  for (const entry of freshEntries.sort((a, b) => a.modifiedMs - b.modifiedMs)) {
    if (totalBytes <= params.maxBytes) return;
    await rm(entry.path, { force: true });
    totalBytes -= entry.sizeBytes;
  }
}

async function listArtifactFiles(artifactDir: string): Promise<ArtifactFileEntry[]> {
  const names = await readdir(artifactDir).catch((error: unknown) => {
    if (isNodeErrorCode(error, 'ENOENT')) return [];
    throw error;
  });

  const entries: ArtifactFileEntry[] = [];
  for (const name of names) {
    const path = join(artifactDir, name);
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat?.isFile()) continue;
    entries.push({
      path,
      modifiedMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
    });
  }
  return entries;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
