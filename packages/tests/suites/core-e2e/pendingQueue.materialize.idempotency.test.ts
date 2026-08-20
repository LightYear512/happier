import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createTestAuth } from '../../src/testkit/auth';
import { countDuplicateLocalIds, createSession, fetchAllMessages, fetchSessionV2 } from '../../src/testkit/sessions';
import { FailureArtifacts } from '../../src/testkit/failureArtifacts';
import { envFlag } from '../../src/testkit/env';
import { writeTestManifestForServer } from '../../src/testkit/manifestForServer';
import { fetchJson } from '../../src/testkit/http';
import { createSessionScopedSocketCollector } from '../../src/testkit/socketClient';
import { waitFor } from '../../src/testkit/timing';
import { enqueuePendingQueueV2, listPendingQueueV2 } from '../../src/testkit/pendingQueueV2';

const run = createRunDirs({ runLabel: 'core' });

describe('core e2e: pending queue v2 materialize idempotency', () => {
  let server: StartedServer | null = null;

  afterAll(async () => {
    await server?.stop();
  });

  it('de-dupes when transcript already contains pending localId (drains pending without duplicating message)', async () => {
    const testDir = run.testDir('pending-queue-v2-materialize-idempotency');
    const saveArtifactsOnSuccess = envFlag(['HAPPIER_E2E_SAVE_ARTIFACTS', 'HAPPY_E2E_SAVE_ARTIFACTS'], false);
    const startedAt = new Date().toISOString();

    server = await startServerLight({ testDir });
    const auth = await createTestAuth(server.baseUrl);
    const { sessionId } = await createSession(server.baseUrl, auth.token);

    const socket = createSessionScopedSocketCollector(server.baseUrl, auth.token, sessionId);

    writeTestManifestForServer({
      testDir,
      server,
      startedAt,
      runId: run.runId,
      testName: 'pending-queue-v2-materialize-idempotency',
      sessionIds: [sessionId],
      env: {
        CI: process.env.CI,
        HAPPIER_E2E_SAVE_ARTIFACTS: process.env.HAPPIER_E2E_SAVE_ARTIFACTS ?? process.env.HAPPY_E2E_SAVE_ARTIFACTS,
      },
    });

    const artifacts = new FailureArtifacts();
    artifacts.json('pending.list.json', async () => await listPendingQueueV2({ baseUrl: server!.baseUrl, token: auth.token, sessionId, includeDiscarded: true }));
    artifacts.json('transcript.json', async () => await fetchAllMessages(server!.baseUrl, auth.token, sessionId));
    artifacts.json('session.v2.json', async () => await fetchSessionV2(server!.baseUrl, auth.token, sessionId));

    let passed = false;
    try {
      socket.connect();
      await waitFor(() => socket.isConnected(), { timeoutMs: 20_000 });

      const localId = `local-${randomUUID()}`;

      // 1) Commit message into transcript first.
      const transcriptCiphertext = Buffer.from('TRANSCRIPT_ALREADY_HAS_LOCAL_ID', 'utf8').toString('base64');
      const writeMsg = await fetchJson<any>(`${server.baseUrl}/v2/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId, ciphertext: transcriptCiphertext }),
        timeoutMs: 20_000,
      });
      expect(writeMsg.status).toBe(200);

      // 2) Enqueue pending with the same localId/content. The public API now short-circuits
      // duplicate transcript localIds as terminal instead of allowing a stale pending row.
      const enqueue = await enqueuePendingQueueV2({ baseUrl: server.baseUrl, token: auth.token, sessionId, localId, ciphertext: transcriptCiphertext, timeoutMs: 20_000 });
      expect(enqueue.status).toBe(200);
      expect(enqueue.data?.didWrite).toBe(false);
      expect(enqueue.data?.terminal).toBe(true);

      // 3) The transcript remains de-duped and no pending row is left to materialize.
      const messages = await fetchAllMessages(server.baseUrl, auth.token, sessionId);
      expect(messages.filter((m) => m.localId === localId).length).toBe(1);
      expect(countDuplicateLocalIds(messages)).toBe(0);

      await waitFor(async () => {
        const pending = await listPendingQueueV2({ baseUrl: server!.baseUrl, token: auth.token, sessionId });
        return pending.status === 200 && Array.isArray(pending.data?.pending) && pending.data.pending.length === 0;
      }, { timeoutMs: 20_000 });

      const snap: any = await fetchSessionV2(server.baseUrl, auth.token, sessionId);
      expect(snap.pendingCount).toBe(0);

      passed = true;
    } finally {
      await artifacts.dumpAll(testDir, { onlyIf: saveArtifactsOnSuccess || !passed });
      socket.close();
    }
  });
});
