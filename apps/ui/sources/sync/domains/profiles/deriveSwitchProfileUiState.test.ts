import { describe, expect, it } from 'vitest';
import type { SwitchProfileEvent } from './profileProvisionRpc';
import { deriveSwitchProfileUiState, isSessionSwitchingInFlight } from './deriveSwitchProfileUiState';

const event = {
    pending: (id = 'target'): SwitchProfileEvent => ({ type: 'switch_pending', targetProfileId: id }),
    complete: (id = 'target'): SwitchProfileEvent => ({ type: 'switch_complete', targetProfileId: id }),
    spawnFailed: (id = 'target'): SwitchProfileEvent => ({ type: 'switch_interrupted', reason: 'spawn_failed', targetProfileId: id }),
    turnInProgress: (id = 'target'): SwitchProfileEvent => ({ type: 'switch_interrupted', reason: 'turn_in_progress', targetProfileId: id }),
};

describe('deriveSwitchProfileUiState', () => {
    it('returns idle for an empty timeline', () => {
        expect(deriveSwitchProfileUiState([])).toEqual({
            state: 'idle',
            interruptionReason: null,
            targetProfileId: null,
        });
    });

    it('returns pending after a pending event', () => {
        expect(deriveSwitchProfileUiState([event.pending('work')])).toEqual({
            state: 'pending',
            interruptionReason: null,
            targetProfileId: 'work',
        });
    });

    it('returns completed after a completion event', () => {
        expect(deriveSwitchProfileUiState([event.pending(), event.complete('work')])).toEqual({
            state: 'completed',
            interruptionReason: null,
            targetProfileId: 'work',
        });
    });

    it('returns the interruption reason from the latest interrupted event', () => {
        expect(deriveSwitchProfileUiState([event.pending(), event.spawnFailed('work')])).toEqual({
            state: 'interrupted',
            interruptionReason: 'spawn_failed',
            targetProfileId: 'work',
        });
    });

    it('lets a fresh pending event clear a previous terminal failure', () => {
        expect(deriveSwitchProfileUiState([event.pending(), event.spawnFailed(), event.pending('retry')])).toEqual({
            state: 'pending',
            interruptionReason: null,
            targetProfileId: 'retry',
        });
    });
});

describe('isSessionSwitchingInFlight', () => {
    it('is true only while the latest derived state is pending', () => {
        expect(isSessionSwitchingInFlight([event.pending()])).toBe(true);
        expect(isSessionSwitchingInFlight([event.pending(), event.complete()])).toBe(false);
        expect(isSessionSwitchingInFlight([event.pending(), event.turnInProgress()])).toBe(false);
    });
});
