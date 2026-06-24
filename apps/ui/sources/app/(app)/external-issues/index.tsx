import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import {
    externalIssueList,
    type ExternalIssueListResponse,
    type ExternalIssueSummary,
} from '@/sync/ops/externalIssues';

type LoadState =
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | { status: 'loaded'; list: ExternalIssueListResponse };

function isErrorResult(value: unknown): value is { ok: false; error: string } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const result = value as Record<string, unknown>;
    return result.ok === false && typeof result.error === 'string';
}

function formatIssueTitle(issue: ExternalIssueSummary): string {
    const issueNumber = typeof issue.issueNumber === 'number' ? `#${issue.issueNumber}` : issue.id;
    const title = typeof issue.title === 'string' && issue.title.trim().length > 0
        ? issue.title.trim()
        : t('externalIssues.fallbackIssueTitle');
    return `${issueNumber} ${title}`;
}

function BodyText(props: Readonly<{ children: React.ReactNode; strong?: boolean }>) {
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

function ExternalIssueRow(props: Readonly<{
    issue: ExternalIssueSummary;
    onPress: () => void;
}>) {
    const { theme } = useUnistyles();
    const issue = props.issue;
    const workflowState = issue.workflow?.workflowState ?? t('externalIssues.workflowUnknown');
    const latestRunState = issue.latestRun?.state
        ? t('externalIssues.latestRunState', { state: issue.latestRun.state })
        : t('externalIssues.noLatestRun');
    const generation = typeof issue.latestRun?.generation === 'number'
        ? t('externalIssues.generation', { generation: issue.latestRun.generation })
        : null;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={formatIssueTitle(issue)}
            onPress={props.onPress}
            testID={`external-issue-row:${issue.id}`}
            style={({ pressed }) => ({
                borderWidth: 1,
                borderColor: theme.colors.border.default,
                borderRadius: 8,
                padding: 12,
                gap: 6,
                backgroundColor: theme.colors.surface.base,
                opacity: pressed ? 0.72 : 1,
            })}
        >
            <BodyText strong>{formatIssueTitle(issue)}</BodyText>
            <BodyText>{issue.repositoryKey ?? issue.repositoryConnection?.repositoryKey ?? t('externalIssues.unknownRepository')}</BodyText>
            <BodyText>{issue.state ?? t('externalIssues.unknown')}</BodyText>
            <BodyText>{workflowState}</BodyText>
            <BodyText>{generation ? `${latestRunState} · ${generation}` : latestRunState}</BodyText>
        </Pressable>
    );
}

export default function ExternalIssueListScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [state, setState] = React.useState<LoadState>({ status: 'loading' });
    const loadGenerationRef = React.useRef(0);
    const headerTint = theme.colors.chrome?.header?.foreground ?? theme.colors.text.primary;

    const load = React.useCallback(async () => {
        const loadGeneration = ++loadGenerationRef.current;
        const commitState = (nextState: LoadState) => {
            if (loadGenerationRef.current !== loadGeneration) return;
            setState(nextState);
        };
        commitState({ status: 'loading' });
        const result = await externalIssueList();
        if (isErrorResult(result)) {
            commitState({ status: 'error', error: result.error });
            return;
        }
        commitState({ status: 'loaded', list: result });
    }, []);

    React.useEffect(() => {
        void load();
    }, [load]);

    const headerRight = React.useCallback(() => (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('externalIssues.a11y.refreshList')}
            onPress={() => void load()}
            testID="external-issues-refresh"
            hitSlop={10}
            style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.7 : 1 })}
        >
            <Ionicons name="refresh" size={20} color={headerTint} />
        </Pressable>
    ), [headerTint, load]);

    return (
        <View testID="external-issues-screen" style={{ flex: 1, backgroundColor: theme.colors.background?.canvas ?? theme.colors.surface.base }}>
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTitle: t('externalIssues.title'),
                    headerRight,
                }}
            />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12 }}>
                <ConstrainedScreenContent style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                    {state.status === 'loading' ? (
                        <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                    ) : state.status === 'error' ? (
                        <BodyText>{state.error}</BodyText>
                    ) : state.list.issues.length === 0 ? (
                        <BodyText>{t('externalIssues.empty')}</BodyText>
                    ) : (
                        <View style={{ gap: 10 }}>
                            {state.list.issues.map((issue) => (
                                <ExternalIssueRow
                                    key={issue.id}
                                    issue={issue}
                                    onPress={() => router.push({
                                        pathname: '/external-issues/[issueRefId]',
                                        params: { issueRefId: issue.id },
                                    })}
                                />
                            ))}
                        </View>
                    )}
                </ConstrainedScreenContent>
            </ScrollView>
        </View>
    );
}
