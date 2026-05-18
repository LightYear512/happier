import { lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type ProfileSymlinkTargetKind = 'directory' | 'file';

function pathExistsForLink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}

function resolveSymlinkType(targetKind: ProfileSymlinkTargetKind): 'dir' | 'file' | 'junction' {
  if (process.platform === 'win32' && targetKind === 'directory') {
    return 'junction';
  }
  return targetKind === 'directory' ? 'dir' : 'file';
}

export function ensureProfileSymlink(params: Readonly<{
  target: string;
  linkPath: string;
  targetKind: ProfileSymlinkTargetKind;
  createMissingFileContent?: string;
}>): void {
  if (pathExistsForLink(params.linkPath)) {
    return;
  }

  mkdirSync(dirname(params.linkPath), { recursive: true });

  if (params.targetKind === 'directory') {
    mkdirSync(params.target, { recursive: true });
  } else if (params.createMissingFileContent !== undefined && !pathExistsForLink(params.target)) {
    mkdirSync(dirname(params.target), { recursive: true });
    try {
      writeFileSync(params.target, params.createMissingFileContent, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) {
        throw error;
      }
    }
  }

  symlinkSync(params.target, params.linkPath, resolveSymlinkType(params.targetKind));
}
