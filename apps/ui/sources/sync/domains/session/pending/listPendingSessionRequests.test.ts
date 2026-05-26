import { describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { derivePendingRequestFlagsFromSession } from './listPendingSessionRequests';

describe('derivePendingRequestFlagsFromSession', () => {
    it('uses projected pending request counts when no transcript request states exist', () => {
        const session = createSessionFixture({
            active: true,
            updatedAt: 10_000,
            agentState: {
                requests: {},
                completedRequests: null,
            },
            pendingPermissionRequestCount: 0,
            pendingUserActionRequestCount: 0,
        });

        expect(derivePendingRequestFlagsFromSession(session, [])).toEqual({
            hasPendingPermissionRequests: false,
            hasPendingUserActionRequests: false,
        });
    });

    it('does not let projected pending request counts hide transcript pending requests', () => {
        const messages: Message[] = Array.from({ length: 1_000 }, (_, index) => ({
            id: `msg-${index}`,
            kind: 'tool-call',
            localId: null,
            createdAt: index + 1,
            tool: {
                id: `tool-${index}`,
                name: 'bash',
                state: 'running',
                input: {},
                createdAt: index + 1,
                startedAt: index + 1,
                completedAt: null,
                description: null,
                permission: {
                    id: `permission-${index}`,
                    status: 'pending',
                },
            },
            children: [],
        }));

        const session = createSessionFixture({
            active: true,
            updatedAt: 10_000,
            agentState: {
                requests: {},
                completedRequests: null,
            },
            pendingPermissionRequestCount: 0,
            pendingUserActionRequestCount: 0,
        });

        expect(derivePendingRequestFlagsFromSession(session, messages)).toEqual({
            hasPendingPermissionRequests: true,
            hasPendingUserActionRequests: false,
        });
    });
});
