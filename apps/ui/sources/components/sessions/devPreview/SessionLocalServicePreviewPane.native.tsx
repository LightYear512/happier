import React from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import {
    isAllowedNativePreviewNavigation,
    shouldOpenExternalNativePreviewNavigation,
    type SessionLocalServicePreviewPaneProps,
    useSessionLocalServicePreviewResolution,
} from './SessionLocalServicePreviewPane.shared';

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
        minHeight: 0,
        minWidth: 0,
    },
    previewFrameContainer: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
    },
    secondary: {
        color: theme.colors.text.secondary,
        fontSize: 12,
    },
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    unavailable: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
}));

function isPreviewDocumentLoadFailure(previewUrl: string, event: unknown): boolean {
    const eventUrl = (event as { nativeEvent?: { url?: unknown } })?.nativeEvent?.url;
    if (typeof eventUrl !== 'string' || eventUrl.trim().length === 0) {
        return true;
    }
    try {
        return new URL(eventUrl, previewUrl).href === new URL(previewUrl).href;
    } catch {
        return true;
    }
}

export function SessionLocalServicePreviewPane(props: SessionLocalServicePreviewPaneProps) {
    const {
        iframeTitle,
        previewRouteBasePath,
        previewUrl,
        relayNamespaceStrategy,
        relayState,
    } = useSessionLocalServicePreviewResolution(
        props,
        { sameMachinePreviewEnabled: false },
    );
    const [webViewLoadFailed, setWebViewLoadFailed] = React.useState(false);

    React.useEffect(() => {
        setWebViewLoadFailed(false);
    }, [previewUrl]);

    const showPreview = Boolean(previewUrl) && !webViewLoadFailed;

    return (
        <View style={styles.container}>
            {showPreview && previewUrl ? (
                <View style={styles.previewFrameContainer}>
                    <WebView
                        testID="session.localServicePreview.webview"
                        source={{ uri: previewUrl }}
                        originWhitelist={[new URL(previewUrl).origin]}
                        javaScriptEnabled
                        domStorageEnabled
                        allowsInlineMediaPlayback
                        setSupportMultipleWindows={false}
                        title={iframeTitle}
                        onShouldStartLoadWithRequest={(request) => {
                            const nextUrl = typeof request?.url === 'string' ? request.url : '';
                            const allowed = isAllowedNativePreviewNavigation({
                                previewUrl,
                                nextUrl,
                                namespaceStrategy: relayNamespaceStrategy,
                                routeBasePath: previewRouteBasePath,
                            });
                            if (!allowed && shouldOpenExternalNativePreviewNavigation(nextUrl)) {
                                void Linking.openURL(nextUrl).catch(() => {});
                            }
                            return allowed;
                        }}
                        onError={(event) => {
                            if (isPreviewDocumentLoadFailure(previewUrl, event)) {
                                setWebViewLoadFailed(true);
                            }
                        }}
                        onHttpError={(event) => {
                            if (isPreviewDocumentLoadFailure(previewUrl, event)) {
                                setWebViewLoadFailed(true);
                            }
                        }}
                    />
                </View>
            ) : relayState === 'loading' ? (
                <View style={styles.loading}>
                    <ActivityIndicator />
                </View>
            ) : (
                <View style={styles.unavailable}>
                    <Text selectable style={styles.secondary}>{t('common.unavailable')}</Text>
                </View>
            )}
        </View>
    );
}
