import * as React from 'react';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';
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
    callProfileProvisionProgress,
    type ProfileProvisionBackendId,
    type ProfileProvisionResult,
} from '@/sync/domains/profiles/profileProvisionRpc';

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
    outputContainer: {
        flex: 1,
        minHeight: 120,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
    },
    outputScroll: {
        flex: 1,
    },
    outputContent: {
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    outputText: {
        fontSize: 12,
        color: theme.colors.text.primary,
        ...Typography.mono(),
    },
    outputLink: {
        color: theme.colors.accent.blue,
        textDecorationLine: 'underline',
    },
}));

export function ProvisionPtyModal(props: ProvisionPtyModalProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [phase, setPhase] = React.useState<ProvisionPhase>({ kind: 'running' });
    const [liveOutput, setLiveOutput] = React.useState('');
    const startedRef = React.useRef(false);

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
            if (next.kind === 'success') {
                props.onProvisioned?.();
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [props.backendId, props.machineId, props.onProvisioned, props.profileId]);

    React.useEffect(() => {
        if (phase.kind !== 'running') return;
        let cancelled = false;
        const intervalId = setInterval(() => {
            void (async () => {
                try {
                    const snapshot = await callProfileProvisionProgress({
                        profileId: props.profileId,
                        backendId: props.backendId,
                        machineId: props.machineId,
                    });
                    if (cancelled) return;
                    setLiveOutput(snapshot.output);
                    if (snapshot.completed) {
                        clearInterval(intervalId);
                    }
                } catch {
                    // Progress polling is best-effort; the final RPC result still carries PTY output.
                }
            })();
        }, 500);
        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, [phase.kind, props.backendId, props.machineId, props.profileId]);

    const backendName = props.backendId === 'codex' ? 'Codex' : 'Claude';
    const ptyOutput = phase.kind === 'success'
        ? phase.result.ptyOutput || liveOutput
        : phase.kind === 'error'
            ? phase.ptyOutput || liveOutput
            : liveOutput;
    const outputSegments = React.useMemo(() => splitTextWithUrls(ptyOutput), [ptyOutput]);
    const closeLabel = phase.kind === 'running'
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

            {outputSegments.length > 0 ? (
                <View style={styles.outputContainer}>
                    <ScrollView style={styles.outputScroll} contentContainerStyle={styles.outputContent}>
                        <Text style={styles.outputText} selectable>
                            {outputSegments.map((segment, index) => (
                                segment.kind === 'url' ? (
                                    <Text
                                        key={`${segment.value}-${index}`}
                                        style={styles.outputLink}
                                        accessibilityRole="link"
                                        onPress={() => {
                                            Linking.openURL(segment.value).catch(() => {});
                                        }}
                                    >
                                        {segment.value}
                                    </Text>
                                ) : (
                                    <Text key={`${segment.value}-${index}`}>{segment.value}</Text>
                                )
                            ))}
                        </Text>
                    </ScrollView>
                </View>
            ) : null}
        </View>
    );
}
