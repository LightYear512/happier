import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';

import {
    buildCodexAppServerCompactSeed,
    CODEX_APP_SERVER_COMPACT_SEED_SENTINEL,
} from './buildCodexAppServerCompactSeed';

describe('buildCodexAppServerCompactSeed', () => {
    const tempRoots = new Set<string>();

    afterEach(async () => {
        await Promise.all([...tempRoots].map((dir) => removeTempDir(dir)));
        tempRoots.clear();
    });

    it('preserves the seed sentinel when trimming oversized rollout context', async () => {
        const root = await createTempDir('happier-codex-app-server-compact-seed-');
        tempRoots.add(root);
        const codexHome = join(root, 'codex-home');
        const threadId = 'thread-seed';
        const rolloutDir = join(codexHome, 'sessions', '2026', '05', '26');
        await mkdir(rolloutDir, { recursive: true });
        await writeFile(
            join(rolloutDir, `rollout-2026-05-26T01-02-03-${threadId}.jsonl`),
            [
                JSON.stringify({
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: 'older context '.repeat(400) }],
                }),
                JSON.stringify({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'recent answer' }],
                }),
            ].join('\n'),
            'utf8',
        );

        const seed = await buildCodexAppServerCompactSeed({
            env: {
                CODEX_HOME: codexHome,
                HAPPIER_CODEX_APP_SERVER_COMPACT_RESCUE_SEED_MAX_CHARS: '2000',
            },
            threadId,
        });

        expect(seed.startsWith(CODEX_APP_SERVER_COMPACT_SEED_SENTINEL)).toBe(true);
        expect(seed.length).toBeLessThanOrEqual(2_000);
        expect(seed).toContain('recent answer');
    });
});
