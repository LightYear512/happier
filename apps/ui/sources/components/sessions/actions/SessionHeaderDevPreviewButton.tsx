import * as React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import type { LocalServicePreviewV1 } from '@happier-dev/protocol';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { createSessionLocalServicePreviewDetailsTab } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';
import { t } from '@/text';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { useOptionalSessionScreenTestId } from '../shell/sessionScreenTestIds';

function getPreviewTitle(preview: LocalServicePreviewV1): string {
    if (typeof preview.name === 'string' && preview.name.trim().length > 0) {
        return preview.name.trim();
    }
    if (preview.origin) return preview.origin;
    if (preview.url) return preview.url;
    return `127.0.0.1:${preview.port}`;
}

function getPreviewSubtitle(preview: LocalServicePreviewV1): string {
    const base = preview.origin ?? `127.0.0.1:${preview.port}`;
    const initialPath = preview.preview?.initialPath;
    if (typeof initialPath !== 'string' || initialPath.length === 0 || initialPath === '/') {
        return base;
    }
    return `${base}${initialPath.startsWith('/') ? initialPath : `/${initialPath}`}`;
}

export const SessionHeaderDevPreviewButton = React.memo((props: Readonly<{
    scopeId: string;
    previews: readonly LocalServicePreviewV1[];
}>) => {
    const { theme } = useUnistyles();
    const pane = useAppPaneScope(props.scopeId);
    const testId = useOptionalSessionScreenTestId('session-header-dev-preview-button');
    const [menuOpen, setMenuOpen] = React.useState(false);

    const openPreview = React.useCallback((preview: LocalServicePreviewV1) => {
        pane.openDetailsTab(createSessionLocalServicePreviewDetailsTab(preview), { intent: 'preview' });
    }, [pane]);

    const onPress = React.useCallback(() => {
        const preview = props.previews[0];
        if (!preview) return;
        openPreview(preview);
    }, [openPreview, props.previews]);

    const menuItems = React.useMemo((): DropdownMenuItem[] => props.previews.map((preview) => ({
        id: preview.resourceId,
        testID: `session-header-dev-preview-menu-item-${preview.resourceId}`,
        title: getPreviewTitle(preview),
        subtitle: getPreviewSubtitle(preview),
    })), [props.previews]);

    const onSelectPreview = React.useCallback((resourceId: string) => {
        setMenuOpen(false);
        const preview = props.previews.find((candidate) => candidate.resourceId === resourceId);
        if (!preview) return;
        openPreview(preview);
    }, [openPreview, props.previews]);

    if (props.previews.length === 0) return null;

    const button = (onButtonPress: () => void) => (
        <Pressable
            testID={testId}
            onPress={onButtonPress}
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

    if (props.previews.length === 1) {
        return button(onPress);
    }

    return (
        <DropdownMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            items={menuItems}
            onSelect={onSelectPreview}
            trigger={({ toggle }) => button(toggle)}
            placement="bottom"
            variant="slim"
            rowKind="selectableRow"
            search={false}
            matchTriggerWidth={false}
            maxWidthCap={320}
        />
    );
});
