import React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { LocalServicePreviewV1 } from '@happier-dev/protocol';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { createSessionLocalServicePreviewDetailsTab } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';
import { Text } from '@/components/ui/text/Text';

const styles = StyleSheet.create((theme) => ({
    card: {
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surfaceHighest,
    },
    content: {
        gap: 6,
    },
    title: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: '600',
    },
    secondary: {
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
}));

export function LocalServicePreviewMessageCard(props: Readonly<{
    payload: LocalServicePreviewV1;
    sessionId: string;
}>) {
    const pane = useAppPaneScope(`session:${props.sessionId}`);
    const title = typeof props.payload.name === 'string' && props.payload.name.trim().length > 0
        ? props.payload.name.trim()
        : `127.0.0.1:${props.payload.port}`;

    const handlePress = React.useCallback(() => {
        pane.openDetailsTab(createSessionLocalServicePreviewDetailsTab(props.payload), { intent: 'preview' });
    }, [pane, props.payload]);

    return (
        <Pressable
            testID="local-service-preview-card"
            accessibilityRole="button"
            onPress={handlePress}
            style={({ pressed }) => [styles.card, { opacity: pressed ? 0.8 : 1 }]}
        >
            <View style={styles.content}>
                <Text selectable style={styles.title}>{title}</Text>
                <Text selectable style={styles.secondary}>{`127.0.0.1:${props.payload.port}`}</Text>
                <Text selectable style={styles.secondary}>{props.payload.health.status}</Text>
            </View>
        </Pressable>
    );
}
