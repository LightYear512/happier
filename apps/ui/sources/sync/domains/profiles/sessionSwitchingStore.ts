import { create } from 'zustand';

import type { SwitchProfileEvent } from './profileProvisionRpc';
import {
    deriveSwitchProfileUiState,
    type DerivedSwitchProfileUi,
} from './deriveSwitchProfileUiState';

type SessionSwitchingStore = Readonly<{
    bySessionId: Readonly<Record<string, DerivedSwitchProfileUi>>;
    setFromEvents: (sessionId: string, events: readonly SwitchProfileEvent[]) => void;
    clear: (sessionId: string) => void;
    clearAll: () => void;
}>;

const IDLE_SWITCH_STATE: DerivedSwitchProfileUi = {
    state: 'idle',
    interruptionReason: null,
    targetProfileId: null,
};

function isSameSwitchState(a: DerivedSwitchProfileUi | undefined, b: DerivedSwitchProfileUi): boolean {
    return a?.state === b.state
        && a.interruptionReason === b.interruptionReason
        && a.targetProfileId === b.targetProfileId;
}

export const useSessionSwitchingStore = create<SessionSwitchingStore>()((set) => ({
    bySessionId: {},
    setFromEvents: (sessionId, events) => {
        set((state) => {
            const derived = deriveSwitchProfileUiState(events);
            if (isSameSwitchState(state.bySessionId[sessionId], derived)) return state;
            return {
                ...state,
                bySessionId: {
                    ...state.bySessionId,
                    [sessionId]: derived,
                },
            };
        });
    },
    clear: (sessionId) => {
        set((state) => {
            if (!(sessionId in state.bySessionId)) return state;
            const { [sessionId]: _removed, ...rest } = state.bySessionId;
            return { ...state, bySessionId: rest };
        });
    },
    clearAll: () => set((state) => ({ ...state, bySessionId: {} })),
}));

export function useSessionSwitchingState(sessionId: string | null | undefined): DerivedSwitchProfileUi {
    return useSessionSwitchingStore((state) => {
        if (!sessionId) return IDLE_SWITCH_STATE;
        return state.bySessionId[sessionId] ?? IDLE_SWITCH_STATE;
    });
}

export function useIsSessionSwitchingInFlight(sessionId: string | null | undefined): boolean {
    return useSessionSwitchingState(sessionId).state === 'pending';
}
