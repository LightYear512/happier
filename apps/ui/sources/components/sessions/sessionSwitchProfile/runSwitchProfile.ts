import type {
    SessionSwitchProfileResult,
    SwitchProfileEvent,
} from '@/sync/domains/profiles/profileProvisionRpc';

export type SwitchProfileOutcome =
    | Readonly<{ kind: 'success'; events: SwitchProfileEvent[] }>
    | Readonly<{ kind: 'turn_in_progress'; events: SwitchProfileEvent[] }>
    | Readonly<{ kind: 'error'; message: string; events: SwitchProfileEvent[] }>;

export type RunSwitchProfileInput = Readonly<{
    sessionId: string;
    targetProfileId: string;
    machineId: string;
}>;

export type RunSwitchProfileDeps = Readonly<{
    call: (params: RunSwitchProfileInput) => Promise<SessionSwitchProfileResult>;
    errorFallback: () => string;
}>;

export async function runSwitchProfile(
    params: RunSwitchProfileInput,
    deps: RunSwitchProfileDeps,
): Promise<SwitchProfileOutcome> {
    try {
        const result = await deps.call(params);
        const events = result.events ?? [];
        if (result.type === 'success') {
            return { kind: 'success', events };
        }
        if (result.errorCode === 'TURN_IN_PROGRESS') {
            return { kind: 'turn_in_progress', events };
        }
        return {
            kind: 'error',
            message: result.errorMessage ?? deps.errorFallback(),
            events,
        };
    } catch (error) {
        return {
            kind: 'error',
            message: error instanceof Error ? error.message : deps.errorFallback(),
            events: [],
        };
    }
}

export function filterSwitchableProfiles<TProfile extends Readonly<{ id: string }>>(
    profiles: readonly TProfile[],
    opts: Readonly<{
        currentProfileId: string | null | undefined;
        isCompatibleWithSession: (profile: TProfile) => boolean;
    }>,
): TProfile[] {
    return profiles.filter((profile) => (
        profile.id !== opts.currentProfileId
        && opts.isCompatibleWithSession(profile)
    ));
}
