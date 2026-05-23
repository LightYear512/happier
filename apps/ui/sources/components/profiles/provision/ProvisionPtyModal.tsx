import * as React from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import {
    callProfileProvision,
    callProfileProvisionVerify,
    type ProfileProvisionBackendId,
    type ProfileProvisionResult,
} from '@/sync/domains/profiles/profileProvisionRpc';
import { EmbeddedTerminalPane } from '@/components/terminal/embedded/EmbeddedTerminalPane';
import type { EmbeddedTerminalRendererHandle } from '@/components/sessions/terminal/embeddedTerminalRendererHandle';
import { useMachineTerminalSession } from '@/hooks/machine/useMachineTerminalSession';
import { useMachine } from '@/sync/domains/state/storage';
import { isMachineOnline } from '@/utils/sessions/machineUtils';

type ProvisionPtyModalProps = CustomModalInjectedProps & Readonly<{
    profileId: string;
    backendId: ProfileProvisionBackendId;
    machineId: string;
    onProvisioned?: () => void;
}>;

export type ProvisionPhase =
    | Readonly<{ kind: 'running' }>
    | Readonly<{ kind: 'success'; result: Extract<ProfileProvisionResult, { type: 'success' }> }>
    | Readonly<{ kind: 'error'; message: string; ptyOutput?: string }>;

const URL_RE = /(https?:\/\/[^\s]+)/g;
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
    return text.replace(ANSI_RE, '');
}

export function splitTextWithUrls(text: string): Array<Readonly<{ kind: 'text' | 'url'; value: string }>> {
    if (!text) return [];
    const clean = stripAnsi(text);
    const out: Array<Readonly<{ kind: 'text' | 'url'; value: string }>> = [];
    let lastIndex = 0;

    for (const match of clean.matchAll(URL_RE)) {
        const index = match.index ?? 0;
        if (index > lastIndex) {
            out.push({ kind: 'text', value: clean.slice(lastIndex, index) });
        }
        out.push({ kind: 'url', value: match[0] });
        lastIndex = index + match[0].length;
    }

    if (lastIndex < clean.length) {
        out.push({ kind: 'text', value: clean.slice(lastIndex) });
    }
    return out;
}

export async function runProvision(
    params: Readonly<{ profileId: string; backendId: ProfileProvisionBackendId; machineId: string }>,
    deps: Readonly<{
        call: typeof callProfileProvision;
        errorFallback: () => string;
    }>,
): Promise<Exclude<ProvisionPhase, { kind: 'running' }>> {
    try {
        const result = await deps.call(params);
        if (result.type === 'success') {
            return { kind: 'success', result };
        }
        return {
            kind: 'error',
            message: result.errorMessage ?? deps.errorFallback(),
            ptyOutput: result.ptyOutput,
        };
    } catch (error) {
        return {
            kind: 'error',
            message: error instanceof Error ? error.message : deps.errorFallback(),
        };
    }
}

export async function verifyProvision(
    params: Readonly<{
        profileId: string;
        backendId: ProfileProvisionBackendId;
        machineId: string;
        profileAuthSessionId?: string | null;
    }>,
    deps: Readonly<{
        call: typeof callProfileProvisionVerify;
        errorFallback: () => string;
    }>,
): Promise<Exclude<ProvisionPhase, { kind: 'running' }>> {
    try {
        const result = await deps.call(params);
        if (result.type === 'success' && result.alreadyProvisioned) {
            return { kind: 'success', result };
        }
        return {
            kind: 'error',
            message: result.type === 'error'
                ? result.errorMessage ?? deps.errorFallback()
                : deps.errorFallback(),
            ptyOutput: result.type === 'error' ? result.ptyOutput : result.ptyOutput,
        };
    } catch (error) {
        return {
            kind: 'error',
            message: error instanceof Error ? error.message : deps.errorFallback(),
        };
    }
}

const stylesheet = StyleSheet.create((theme) => ({
    body: {
        flex: 1,
        paddingHorizontal: 16,
        paddingVertical: 16,
        gap: 12,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    statusText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.text.primary,
        ...Typography.default(),
    },
    terminalContainer: {
        flex: 1,
        minHeight: 120,
    },
}));

export function ProvisionPtyModal(props: ProvisionPtyModalProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [phase, setPhase] = React.useState<ProvisionPhase>({ kind: 'running' });
    const startedRef = React.useRef(false);
    const terminalRendererRef = React.useRef<EmbeddedTerminalRendererHandle | null>(null);
    const machine = useMachine(props.machineId);
    const machineReachable = Boolean(machine && isMachineOnline(machine));

    React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        let cancelled = false;

        void (async () => {
            const next = await runProvision({
                profileId: props.profileId,
                backendId: props.backendId,
                machineId: props.machineId,
            }, {
                call: callProfileProvision,
                errorFallback: () => t('profiles.provision.errorBody'),
            });
            if (cancelled) return;
            setPhase(next);
            if (next.kind === 'success' && next.result.alreadyProvisioned) {
                props.onProvisioned?.();
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [props.backendId, props.machineId, props.onProvisioned, props.profileId]);

    const preparedSession = phase.kind === 'success' && !phase.result.alreadyProvisioned
        ? phase.result
        : null;
    const terminalController = useMachineTerminalSession({
        machineId: props.machineId,
        cwd: preparedSession?.profileDir ?? null,
        machineReachable,
        machineRpcTargetAvailable: Boolean(props.machineId && preparedSession),
        terminalKey: preparedSession?.terminalKey ?? `profile-login:${props.machineId}:${props.backendId}:${props.profileId}`,
        terminalRef: terminalRendererRef,
        profileAuthSessionId: preparedSession?.profileAuthSessionId,
        closeOnUnmount: true,
    });

    const verifyingRef = React.useRef(false);
    React.useEffect(() => {
        if (!preparedSession || terminalController.status !== 'exited' || verifyingRef.current) return;
        verifyingRef.current = true;
        let cancelled = false;
        void (async () => {
            const next = await verifyProvision({
                profileId: props.profileId,
                backendId: props.backendId,
                machineId: props.machineId,
                profileAuthSessionId: preparedSession.profileAuthSessionId,
            }, {
                call: callProfileProvisionVerify,
                errorFallback: () => t('profiles.provision.errorBody'),
            });
            if (cancelled) return;
            setPhase(next);
            if (next.kind === 'success') {
                props.onProvisioned?.();
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [preparedSession, props.backendId, props.machineId, props.onProvisioned, props.profileId, terminalController.status]);

    const backendName = props.backendId === 'codex' ? 'Codex' : 'Claude';
    const closeLabel = phase.kind === 'running' || preparedSession
        ? t('profiles.provision.runInBackground')
        : phase.kind === 'success'
            ? t('common.done')
            : t('common.close');

    const footer = React.useMemo(() => (
        <RoundButton
            testID="profile-provision-close"
            title={closeLabel}
            size="normal"
            onPress={props.onClose}
        />
    ), [closeLabel, props.onClose]);

    useModalCardChrome(props.setChrome, React.useMemo(() => ({
        kind: 'card' as const,
        title: t('profiles.provision.modalTitle', { backend: backendName }),
        footer,
        layout: 'fill' as const,
        dimensions: { width: 560, maxHeightRatio: 0.8 },
    }), [backendName, footer]));

    return (
        <View style={styles.body}>
            <View style={styles.statusRow}>
                {phase.kind === 'running' ? (
                    <ActivityIndicator size="small" color={theme.colors.text.secondary} />
                ) : (
                    <Ionicons
                        name={phase.kind === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                        size={22}
                        color={theme.colors.text.secondary}
                    />
                )}
                <Text style={styles.statusText}>
                    {phase.kind === 'running'
                        ? t('profiles.provision.inProgressHint')
                        : phase.kind === 'success'
                            ? (phase.result.alreadyProvisioned
                                ? t('profiles.provision.alreadyProvisioned')
                                : t('profiles.provision.successHint'))
                            : phase.message}
                </Text>
            </View>

            {preparedSession ? (
                <View style={styles.terminalContainer}>
                    <EmbeddedTerminalPane
                        title={t('profiles.provision.modalTitle', { backend: backendName })}
                        controller={terminalController}
                        terminalRef={terminalRendererRef}
                        onRequestClose={props.onClose}
                        testIdPrefix="profile-provision-terminal"
                        showQuickKeys={Platform.OS !== 'web'}
                    />
                </View>
            ) : null}
        </View>
    );
}
