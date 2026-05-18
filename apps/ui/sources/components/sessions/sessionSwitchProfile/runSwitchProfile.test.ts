import { describe, expect, it, vi } from 'vitest';
import type { SessionSwitchProfileResult } from '@/sync/domains/profiles/profileProvisionRpc';
import { filterSwitchableProfiles, runSwitchProfile } from './runSwitchProfile';

const params = { sessionId: 'session-1', targetProfileId: 'work', machineId: 'machine-1' };
const errorFallback = () => 'fallback error';

describe('runSwitchProfile', () => {
    it('maps a successful RPC result to a success outcome with events', async () => {
        const response: SessionSwitchProfileResult = {
            type: 'success',
            events: [
                { type: 'switch_pending', targetProfileId: 'work' },
                { type: 'switch_complete', targetProfileId: 'work' },
            ],
        };
        const call = vi.fn(async () => response);

        const outcome = await runSwitchProfile(params, { call, errorFallback });

        expect(outcome.kind).toBe('success');
        expect(outcome.events.map((event) => event.type)).toEqual(['switch_pending', 'switch_complete']);
    });

    it('maps turn-in-progress failures to a dedicated outcome', async () => {
        const response: SessionSwitchProfileResult = {
            type: 'error',
            errorCode: 'TURN_IN_PROGRESS',
            errorMessage: 'turn active',
            events: [{ type: 'switch_interrupted', reason: 'turn_in_progress', targetProfileId: 'work' }],
        };
        const call = vi.fn(async () => response);

        const outcome = await runSwitchProfile(params, { call, errorFallback });

        expect(outcome.kind).toBe('turn_in_progress');
        expect(outcome.events).toEqual(response.events);
    });

    it('maps other RPC failures to error outcome', async () => {
        const response: SessionSwitchProfileResult = {
            type: 'error',
            errorCode: 'PROFILE_NOT_PROVISIONED',
            errorMessage: 'not provisioned',
            events: [],
        };
        const call = vi.fn(async () => response);

        const outcome = await runSwitchProfile(params, { call, errorFallback });

        expect(outcome).toEqual({ kind: 'error', message: 'not provisioned', events: [] });
    });

    it('uses the fallback message when a thrown value has no message', async () => {
        const call = vi.fn(async () => {
            throw 'bad';
        });

        const outcome = await runSwitchProfile(params, { call, errorFallback });

        expect(outcome).toEqual({ kind: 'error', message: 'fallback error', events: [] });
    });
});

describe('filterSwitchableProfiles', () => {
    const profiles = [
        { id: 'current' },
        { id: 'work' },
        { id: 'personal' },
    ];

    it('drops the current profile and incompatible profiles', () => {
        expect(filterSwitchableProfiles(profiles, {
            currentProfileId: 'current',
            isCompatibleWithSession: (profile) => profile.id !== 'personal',
        }).map((profile) => profile.id)).toEqual(['work']);
    });
});
