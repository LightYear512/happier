import type { WorkspaceUploadEntry } from '@/hooks/session/files/useWorkspaceFileTransfers';

export function buildWebUploadEntriesFromFiles(files: readonly File[]): WorkspaceUploadEntry[] {
    return files.map((file) => ({
        kind: 'web',
        file,
        relativePath: (file as any).webkitRelativePath || file.name,
    }));
}
