import * as React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import type { LocalServicePreviewV1 } from '@happier-dev/protocol';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { createSessionLocalServicePreviewDetailsTab } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';
import { t } from '@/text';
import { useOptionalSessionScreenTestId } from '../shell/sessionScreenTestIds';

export const SessionHeaderDevPreviewButton = React.memo((props: Readonly<{
    scopeId: string;
    previews: readonly LocalServicePreviewV1[];
}>) => {
    const { theme } = useUnistyles();
    const pane = useAppPaneScope(props.scopeId);
    const testId = useOptionalSessionScreenTestId('session-header-dev-preview-button');

    const openPreviews = React.useCallback(() => {
        const previews = props.previews;
        if (previews.length === 0) return;

        for (const preview of previews) {
            pane.openDetailsTab(createSessionLocalServicePreviewDetailsTab(preview), { intent: 'preview' });
        }

        const activePreview = previews[0];
        if (previews.length > 1 && activePreview) {
            pane.setActiveDetailsTab(`localServicePreview:${activePreview.resourceId}`);
        }
    }, [pane, props.previews]);

    const onPress = React.useCallback(() => {
        openPreviews();
    }, [openPreviews]);

    if (props.previews.length === 0) return null;

    return (
        <Pressable
            testID={testId}
            onPress={onPress}
            hitSlop={15}
            style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel={`${t('common.open')} preview`}
        >
            <Ionicons name="globe-outline" size={22} color={theme.colors.chrome.header.foreground} />
        </Pressable>
    );
});
