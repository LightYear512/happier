import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  DeviceWriter,
  PreviewReservation,
  SimulatorDeviceLockStore,
} from './simulatorDeviceLockStoreTypes';

type FileLockStoreState = Readonly<{
  writers: Record<string, DeviceWriter | undefined>;
  previews: Record<string, PreviewReservation | undefined>;
}>;

const FILE_LOCK_STALE_MS = 30_000;
const FILE_LOCK_RETRY_SLEEP_MS = 25;

function emptyFileLockStoreState(): FileLockStoreState {
  return { writers: {}, previews: {} };
}

function parseFileLockStoreState(raw: string): FileLockStoreState {
  try {
    const parsed = JSON.parse(raw) as Partial<FileLockStoreState>;
    return {
      writers: parsed.writers && typeof parsed.writers === 'object' ? parsed.writers : {},
      previews: parsed.previews && typeof parsed.previews === 'object' ? parsed.previews : {},
    };
  } catch {
    return emptyFileLockStoreState();
  }
}

function readFileLockStoreState(lockStorePath: string): FileLockStoreState {
  if (!existsSync(lockStorePath)) return emptyFileLockStoreState();
  return parseFileLockStoreState(readFileSync(lockStorePath, 'utf8'));
}

function writeFileLockStoreState(lockStorePath: string, state: FileLockStoreState): void {
  mkdirSync(dirname(lockStorePath), { recursive: true });
  const tempPath = `${lockStorePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tempPath, lockStorePath);
}

function mutateFileLockStoreState(lockStorePath: string, mutate: (state: FileLockStoreState) => FileLockStoreState): void {
  const current = readFileLockStoreState(lockStorePath);
  writeFileLockStoreState(lockStorePath, mutate(current));
}

function tryAcquireFileLock(lockPath: string): number | null {
  mkdirSync(dirname(lockPath), { recursive: true });
  try {
    return openSync(lockPath, 'wx');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw error;
    try {
      const raw = readFileSync(lockPath, 'utf8').trim();
      const [, createdAtText] = raw.split(/\s+/u);
      const createdAtMs = Number.parseInt(createdAtText ?? '', 10);
      if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > FILE_LOCK_STALE_MS) {
        rmSync(lockPath, { force: true });
        return openSync(lockPath, 'wx');
      }
    } catch {
      rmSync(lockPath, { force: true });
      return openSync(lockPath, 'wx');
    }
    return null;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function createFileSimulatorDeviceLockStore(input: Readonly<{
  lockStorePath: string;
}>): SimulatorDeviceLockStore {
  const lockStorePath = input.lockStorePath;
  const lockPath = `${lockStorePath}.lock`;
  function withFileLock<T>(fn: () => T): T {
    const deadlineMs = Date.now() + 5_000;
    let fd: number | null = null;
    while (fd == null) {
      fd = tryAcquireFileLock(lockPath);
      if (fd != null) break;
      if (Date.now() > deadlineMs) {
        throw new Error(`Timed out acquiring simulator device lock store: ${lockPath}`);
      }
      sleepSync(FILE_LOCK_RETRY_SLEEP_MS);
    }
    try {
      writeFileSync(fd, `${process.pid} ${Date.now()}\n`, 'utf8');
      return fn();
    } finally {
      try {
        closeSync(fd);
        rmSync(lockPath, { force: true });
      } catch {
        rmSync(lockPath, { force: true });
      }
    }
  }
  return {
    withLock: withFileLock,
    getWriter: (deviceRef) => readFileLockStoreState(lockStorePath).writers[deviceRef],
    setWriter: (deviceRef, writer) => {
      mutateFileLockStoreState(lockStorePath, (state) => ({
        ...state,
        writers: { ...state.writers, [deviceRef]: writer },
      }));
    },
    deleteWriter: (deviceRef) => {
      mutateFileLockStoreState(lockStorePath, (state) => {
        const writers = { ...state.writers };
        delete writers[deviceRef];
        return { ...state, writers };
      });
    },
    listWriters: () => Object.entries(readFileLockStoreState(lockStorePath).writers)
      .filter((entry): entry is [string, DeviceWriter] => Boolean(entry[1]))
      .map(([deviceRef, writer]) => ({ deviceRef, writer })),
    getPreview: (previewRef) => readFileLockStoreState(lockStorePath).previews[previewRef],
    setPreview: (previewRef, reservation) => {
      mutateFileLockStoreState(lockStorePath, (state) => ({
        ...state,
        previews: { ...state.previews, [previewRef]: reservation },
      }));
    },
    deletePreview: (previewRef) => {
      mutateFileLockStoreState(lockStorePath, (state) => {
        const previews = { ...state.previews };
        delete previews[previewRef];
        return { ...state, previews };
      });
    },
    listPreviews: () => Object.values(readFileLockStoreState(lockStorePath).previews)
      .filter((reservation): reservation is PreviewReservation => Boolean(reservation)),
  };
}
