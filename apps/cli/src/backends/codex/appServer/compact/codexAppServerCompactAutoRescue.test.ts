import { describe, expect, it } from 'vitest';

import { createCodexAppServerCompactRescueGate, shouldAutoRescueCodexAppServerCompactFailure } from './codexAppServerCompactAutoRescue';

describe('shouldAutoRescueCodexAppServerCompactFailure', () => {
    it('matches the Codex remote compact task failure signature', () => {
        expect(shouldAutoRescueCodexAppServerCompactFailure({
            error: {
                message: 'Error running remote compact task: stream disconnected before completion',
                codexErrorInfo: 'other',
                additionalDetails: null,
            },
            willRetry: false,
        })).toBe(true);
    });

    it('matches the compact task signature nested in turn.error', () => {
        expect(shouldAutoRescueCodexAppServerCompactFailure({
            turn: {
                error: {
                    message: 'ERROR RUNNING REMOTE COMPACT TASK: upstream closed',
                },
            },
            willRetry: false,
        })).toBe(true);
    });

    it('does not match generic stream disconnects without the compact task signature', () => {
        expect(shouldAutoRescueCodexAppServerCompactFailure({
            error: {
                message: 'stream disconnected before completion',
            },
            willRetry: false,
        })).toBe(false);
    });

    it('does not match retryable compact failures', () => {
        expect(shouldAutoRescueCodexAppServerCompactFailure({
            error: {
                message: 'Error running remote compact task: temporary upstream failure',
            },
            willRetry: true,
        })).toBe(false);
    });
});

describe('createCodexAppServerCompactRescueGate', () => {
    it('allows the first claim and blocks claims inside the cooldown', () => {
        const gate = createCodexAppServerCompactRescueGate(30_000);

        expect(gate.tryClaim(1_000)).toBe(true);
        expect(gate.tryClaim(20_000)).toBe(false);
        expect(gate.tryClaim(31_001)).toBe(true);
    });

    it('releases a failed claim so the next failure can be rescued', () => {
        const gate = createCodexAppServerCompactRescueGate(30_000);

        expect(gate.tryClaim(1_000)).toBe(true);
        gate.release();
        expect(gate.tryClaim(2_000)).toBe(true);
    });
});
