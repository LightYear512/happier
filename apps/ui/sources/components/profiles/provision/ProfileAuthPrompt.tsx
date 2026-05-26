import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { ProfileProvisionBackendId } from '@/sync/domains/profiles/profileProvisionRpc';
import type { ProfileAuthDisplayState } from './profileAuthDisplayState';

export type ProfileAuthPromptProps = Readonly<{
    backendId: ProfileProvisionBackendId;
    displayState: ProfileAuthDisplayState;
    showDetails: boolean;
    onCopy: (value: string) => void;
    onOpen: (url: string) => void;
    onToggleDetails: () => void;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    authPrompt: {
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        borderRadius: 8,
        padding: 14,
        gap: 12,
        backgroundColor: theme.colors.surface.inset,
    },
    authPromptTitle: {
        fontSize: 15,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
    },
    authPromptBody: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    valueBox: {
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface.base,
    },
    valueText: {
        fontSize: 16,
        color: theme.colors.text.primary,
        ...Typography.mono(),
    },
    deviceCodeText: {
        fontSize: 28,
        color: theme.colors.text.primary,
        textAlign: 'center',
        ...Typography.mono(),
    },
    actionRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    detailsToggle: {
        alignSelf: 'flex-start',
        paddingVertical: 4,
    },
    detailsToggleText: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        ...Typography.default('semiBold'),
    },
}));

export function ProfileAuthPrompt(props: ProfileAuthPromptProps) {
    const styles = stylesheet;
    const displayState = props.displayState;

    return (
        <View testID="profile-provision-auth-prompt" style={styles.authPrompt}>
            {displayState.kind === 'waiting' ? (
                <>
                    <Text style={styles.authPromptTitle}>
                        {props.backendId === 'codex' ? 'Waiting for Codex device code' : 'Waiting for Claude login link'}
                    </Text>
                    <Text style={styles.authPromptBody}>
                        {t('profiles.machineLogin.subtitle')}
                    </Text>
                </>
            ) : displayState.kind === 'device-code' ? (
                <>
                    <Text style={styles.authPromptTitle}>{t('connectedServices.deviceAuth.userCode')}</Text>
                    <View testID="profile-provision-device-code" style={styles.valueBox}>
                        <Text selectable style={styles.deviceCodeText}>{displayState.deviceCode}</Text>
                    </View>
                    <View testID="profile-provision-login-url" style={styles.valueBox}>
                        <Text selectable numberOfLines={2} style={styles.valueText}>{displayState.loginUrl}</Text>
                    </View>
                    <View style={styles.actionRow}>
                        <RoundButton testID="profile-provision-open-link" title={t('common.open')} size="normal" onPress={() => props.onOpen(displayState.loginUrl)} />
                        <RoundButton testID="profile-provision-copy-link" title={t('common.copyWithLabel', { label: 'URL' })} size="normal" onPress={() => props.onCopy(displayState.loginUrl)} />
                        <RoundButton testID="profile-provision-copy-code" title={t('common.copyWithLabel', { label: 'Code' })} size="normal" onPress={() => props.onCopy(displayState.deviceCode)} />
                    </View>
                </>
            ) : (
                <>
                    <Text style={styles.authPromptTitle}>
                        {props.backendId === 'codex' ? 'Open this Codex login link' : 'Open this Claude login link'}
                    </Text>
                    <View testID="profile-provision-login-url" style={styles.valueBox}>
                        <Text selectable style={styles.valueText}>{displayState.loginUrl}</Text>
                    </View>
                    <View style={styles.actionRow}>
                        <RoundButton testID="profile-provision-open-link" title={t('common.open')} size="normal" onPress={() => props.onOpen(displayState.loginUrl)} />
                        <RoundButton testID="profile-provision-copy-link" title={t('common.copyWithLabel', { label: 'URL' })} size="normal" onPress={() => props.onCopy(displayState.loginUrl)} />
                    </View>
                </>
            )}
            <Pressable
                testID="profile-provision-toggle-details"
                style={styles.detailsToggle}
                onPress={props.onToggleDetails}
            >
                <Text style={styles.detailsToggleText}>
                    {props.showDetails ? 'Hide details' : 'Show details'}
                </Text>
            </Pressable>
        </View>
    );
}
