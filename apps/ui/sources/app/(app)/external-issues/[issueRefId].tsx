import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import {
    externalIssueExecutionStateGet,
    type ExternalIssueExecutionState,
    type ExternalIssueProviderActionSummary,
    type ExternalIssueSessionRunSummary,
} from '@/sync/ops/externalIssues';

type LoadState =
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | { status: 'loaded'; executionState: ExternalIssueExecutionState };

function normalizeParam(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) return value[0].trim();
    return null;
}

function isErrorResult(value: unknown): value is { ok: false; error: string } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const result = value as Record<string, unknown>;
    return result.ok === false && typeof result.error === 'string';
}

function formatIssueTitle(state: ExternalIssueExecutionState): string {
    const issueNumber = typeof state.issue.issueNumber === 'number' ? `#${state.issue.issueNumber}` : state.issue.id;
    const title = typeof state.issue.title === 'string' && state.issue.title.trim().length > 0
        ? state.issue.title.trim()
        : t('externalIssues.fallbackIssueTitle');
    return `${issueNumber} ${title}`;
}

function formatRunLine(run: ExternalIssueSessionRunSummary): string {
    const generation = typeof run.generation === 'number'
        ? t('externalIssues.generation', { generation: run.generation })
        : t('externalIssues.generationUnknown');
    const state = run.state ?? t('externalIssues.unknown');
    const claimedBy = run.claimedByMachineId
        ? t('externalIssues.claimedByMachine', { machineId: run.claimedByMachineId })
        : t('externalIssues.unclaimed');
    return `${run.id} · ${state} · ${generation} · ${claimedBy}`;
}

function formatProviderActionLine(action: ExternalIssueProviderActionSummary): string {
    const kind = action.actionKind ?? 'provider_action';
    const state = action.state ?? t('externalIssues.unknown');
    const externalId = action.providerExternalId ?? action.lastErrorCode ?? t('externalIssues.noProviderResult');
    return `${kind} · ${state} · ${externalId}`;
}

function SummaryText(props: Readonly<{ children: React.ReactNode; strong?: boolean }>) {
    const { theme } = useUnistyles();
    return (
        <Text
            style={{
                color: props.strong ? theme.colors.text.primary : theme.colors.text.secondary,
                fontSize: props.strong ? 16 : 13,
                fontWeight: props.strong ? '600' : '400',
                lineHeight: props.strong ? 22 : 18,
            }}
        >
            {props.children}
        </Text>
    );
}

function StatusBlock(props: Readonly<{ title: string; children: React.ReactNode }>) {
    const { theme } = useUnistyles();
    return (
        <View
            style={{
                borderWidth: 1,
                borderColor: theme.colors.border.default,
                borderRadius: 8,
                padding: 12,
                gap: 6,
                backgroundColor: theme.colors.surface.base,
            }}
        >
            <SummaryText strong>{props.title}</SummaryText>
            {props.children}
        </View>
    );
}

function ExternalIssueExecutionStateView(props: Readonly<{ executionState: ExternalIssueExecutionState }>) {
    const state = props.executionState;
    const repository = state.repositoryConnection?.repositoryKey ?? t('externalIssues.unknownRepository');
    const activeRun = state.activeRun;
    const latestRun = state.latestRuns[0] ?? null;

    return (
        <View testID="external-issue-execution-state" style={{ gap: 12 }}>
            <StatusBlock title={formatIssueTitle(state)}>
                <SummaryText>{repository}</SummaryText>
                <SummaryText>{state.issue.state ?? t('externalIssues.unknown')}</SummaryText>
            </StatusBlock>

            <StatusBlock title={t('externalIssues.workflow')}>
                <SummaryText>{state.workflow.workflowState ?? t('externalIssues.unknown')}</SummaryText>
                <SummaryText>{state.workflow.activePrimaryRunId ?? t('externalIssues.noActivePrimaryRun')}</SummaryText>
            </StatusBlock>

            <StatusBlock title={t('externalIssues.sessionRun')}>
                <SummaryText>{activeRun ? formatRunLine(activeRun) : t('externalIssues.noActiveRun')}</SummaryText>
                <SummaryText>{latestRun ? formatRunLine(latestRun) : t('externalIssues.noLatestRun')}</SummaryText>
            </StatusBlock>

            <StatusBlock title={t('externalIssues.providerActions')}>
                {state.providerActions.length > 0 ? (
                    state.providerActions.map((action) => (
                        <SummaryText key={action.id}>{formatProviderActionLine(action)}</SummaryText>
                    ))
                ) : (
                    <SummaryText>{t('externalIssues.noProviderActions')}</SummaryText>
                )}
            </StatusBlock>
        </View>
    );
}

export default function ExternalIssueExecutionStateScreen() {
    const { theme } = useUnistyles();
    const params = useLocalSearchParams();
    const issueRefId = normalizeParam((params as Record<string, unknown>)?.issueRefId);
    const [state, setState] = React.useState<LoadState>({ status: 'loading' });
    const loadGenerationRef = React.useRef(0);
    const headerTint = theme.colors.chrome?.header?.foreground ?? theme.colors.text.primary;

    const load = React.useCallback(async () => {
        const loadGeneration = ++loadGenerationRef.current;
        const commitState = (nextState: LoadState) => {
            if (loadGenerationRef.current !== loadGeneration) return;
            setState(nextState);
        };

        if (!issueRefId) {
            commitState({ status: 'error', error: t('externalIssues.missingIssueRefId') });
            return;
        }

        commitState({ status: 'loading' });
        const result = await externalIssueExecutionStateGet(issueRefId);
        if (isErrorResult(result)) {
            commitState({ status: 'error', error: result.error });
            return;
        }
        commitState({ status: 'loaded', executionState: result });
    }, [issueRefId]);

    React.useEffect(() => {
        void load();
    }, [load]);

    const headerRight = React.useCallback(() => (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('externalIssues.a11y.refreshDetail')}
            onPress={() => void load()}
            testID="external-issue-refresh"
            hitSlop={10}
            style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.7 : 1 })}
        >
            <Ionicons name="refresh" size={20} color={headerTint} />
        </Pressable>
    ), [headerTint, load]);

    const screenOptions = React.useMemo(() => ({
        headerShown: true,
        headerTitle: t('externalIssues.detailTitle'),
        headerRight,
    }), [headerRight]);

    return (
        <View testID="external-issue-screen" style={{ flex: 1, backgroundColor: theme.colors.background?.canvas ?? theme.colors.surface.base }}>
            <Stack.Screen options={screenOptions} />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12 }}>
                <ConstrainedScreenContent style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                    {state.status === 'loading' ? (
                        <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                    ) : state.status === 'error' ? (
                        <SummaryText>{state.error}</SummaryText>
                    ) : (
                        <ExternalIssueExecutionStateView executionState={state.executionState} />
                    )}
                </ConstrainedScreenContent>
            </ScrollView>
        </View>
    );
}
