import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import type { LocalServicePreviewV1 } from '@happier-dev/protocol';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { createSessionLocalServicePreviewDetailsTab } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Modal } from '@/modal';
import { createDefaultActionExecutor } from '@/sync/ops/actions/defaultActionExecutor';
import { t } from '@/text';
import { useOptionalSessionScreenTestId } from '../shell/sessionScreenTestIds';
import { fireAndForget } from '@/utils/system/fireAndForget';

export const SessionHeaderDevPreviewButton = React.memo((props: Readonly<{
    scopeId: string;
    previews: readonly LocalServicePreviewV1[];
}>) => {
    const { theme } = useUnistyles();
    const pane = useAppPaneScope(props.scopeId);
    const testId = useOptionalSessionScreenTestId('session-header-dev-preview-button');
    const [open, setOpen] = React.useState(false);
    const [stoppingResourceId, setStoppingResourceId] = React.useState<string | null>(null);
    const executor = React.useMemo(() => createDefaultActionExecutor(), []);

    const sessionId = React.useMemo(() => {
        for (const preview of props.previews) {
            const candidate = typeof preview.sessionId === 'string' ? preview.sessionId.trim() : '';
            if (candidate) return candidate;
        }
        const prefix = 'session:';
        return props.scopeId.startsWith(prefix) ? props.scopeId.slice(prefix.length).trim() : '';
    }, [props.previews, props.scopeId]);

    const previewByActionId = React.useMemo(() => {
        const out = new Map<string, LocalServicePreviewV1>();
        for (const preview of props.previews) {
            out.set(`open:${preview.resourceId}`, preview);
            out.set(`stop:${preview.resourceId}`, preview);
        }
        return out;
    }, [props.previews]);

    const items = React.useMemo<DropdownMenuItem[]>(() => props.previews.flatMap((preview) => {
        const title = typeof preview.name === 'string' && preview.name.trim().length > 0
            ? preview.name.trim()
            : `127.0.0.1:${preview.port}`;
        const subtitleParts = [
            `127.0.0.1:${preview.port}`,
            typeof preview.framework === 'string' ? preview.framework : '',
            preview.health.status,
        ].map((part) => String(part ?? '').trim()).filter(Boolean);
        const subtitle = subtitleParts.join(' · ');
        const stopping = stoppingResourceId === preview.resourceId;
        return [
            {
                id: `open:${preview.resourceId}`,
                testID: `session-header-dev-preview-open:${preview.resourceId}`,
                title,
                subtitle,
                icon: <Ionicons name="open-outline" size={16} color={theme.colors.text.primary} />,
            },
            {
                id: `stop:${preview.resourceId}`,
                testID: `session-header-dev-preview-stop:${preview.resourceId}`,
                title: `${t('voiceSurface.stop')} ${title}`,
                subtitle,
                disabled: stopping,
                icon: <Ionicons name="stop-circle-outline" size={16} color={theme.colors.text.primary} />,
            },
        ];
    }), [props.previews, stoppingResourceId, theme.colors.text.primary]);

    const openPreview = React.useCallback((preview: LocalServicePreviewV1) => {
        pane.openDetailsTab(createSessionLocalServicePreviewDetailsTab(preview), { intent: 'preview' });
        pane.setActiveDetailsTab(`localServicePreview:${preview.resourceId}`);
    }, [pane]);

    const stopPreview = React.useCallback((preview: LocalServicePreviewV1) => {
        if (!sessionId) return;
        setStoppingResourceId(preview.resourceId);
        fireAndForget((async () => {
            const result = await executor.execute(
                'session.devPreview.close',
                { sessionId, resourceId: preview.resourceId },
                { surface: 'ui_button', defaultSessionId: sessionId },
            );
            const inner = (result as any)?.result ?? null;
            if ((result as any)?.ok === true && inner?.ok === true) {
                pane.closeDetailsTab(`localServicePreview:${preview.resourceId}`);
                setOpen(false);
                return;
            }
            Modal.alert(t('common.error'), String((result as any)?.error ?? inner?.error ?? 'preview_close_failed'));
        })().finally(() => {
            setStoppingResourceId((current) => current === preview.resourceId ? null : current);
        }), { tag: 'SessionHeaderDevPreviewButton.stopPreview' });
    }, [executor, pane, sessionId]);

    if (props.previews.length === 0) return null;

    return (
        <DropdownMenu
            open={open}
            onOpenChange={setOpen}
            items={items}
            onSelect={(actionId) => {
                const preview = previewByActionId.get(actionId);
                if (!preview) return;
                if (actionId.startsWith('open:')) {
                    setOpen(false);
                    openPreview(preview);
                    return;
                }
                if (actionId.startsWith('stop:')) {
                    stopPreview(preview);
                }
            }}
            trigger={({ toggle }) => (
                <Pressable
                    testID={testId}
                    onPress={toggle}
                    hitSlop={15}
                    style={({ pressed }) => ({
                        width: 44,
                        height: 44,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: pressed ? 0.7 : 1,
                    })}
                    accessibilityRole="button"
                    accessibilityLabel={t('settingsFeatures.expSessionsDevPreview')}
                >
                    <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="globe-outline" size={22} color={theme.colors.chrome.header.foreground} />
                    </View>
                </Pressable>
            )}
            placement="bottom"
            variant="slim"
            rowKind="selectableRow"
            search={false}
            matchTriggerWidth={false}
            maxWidthCap={360}
        />
    );
});
