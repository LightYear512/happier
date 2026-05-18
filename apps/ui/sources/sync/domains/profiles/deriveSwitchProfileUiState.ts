import type { SwitchProfileEvent } from './profileProvisionRpc';

export type SwitchProfileUiState = 'idle' | 'pending' | 'completed' | 'interrupted';

export type DerivedSwitchProfileUi = Readonly<{
    state: SwitchProfileUiState;
    interruptionReason: 'turn_in_progress' | 'spawn_failed' | null;
    targetProfileId: string | null;
}>;

export function deriveSwitchProfileUiState(events: readonly SwitchProfileEvent[]): DerivedSwitchProfileUi {
    let state: SwitchProfileUiState = 'idle';
    let interruptionReason: DerivedSwitchProfileUi['interruptionReason'] = null;
    let targetProfileId: string | null = null;

    for (const event of events) {
        targetProfileId = event.targetProfileId;
        if (event.type === 'switch_pending') {
            state = 'pending';
            interruptionReason = null;
        } else if (event.type === 'switch_complete') {
            state = 'completed';
            interruptionReason = null;
        } else {
            state = 'interrupted';
            interruptionReason = event.reason;
        }
    }

    return { state, interruptionReason, targetProfileId };
}

export function resolveSessionSwitchingProfileIdOverride(state: DerivedSwitchProfileUi): string | null {
    return state.state === 'pending' || state.state === 'completed'
        ? state.targetProfileId
        : null;
}

export function isSessionSwitchingInFlight(events: readonly SwitchProfileEvent[]): boolean {
    return deriveSwitchProfileUiState(events).state === 'pending';
}
