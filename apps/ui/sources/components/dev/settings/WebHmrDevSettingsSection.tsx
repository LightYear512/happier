import * as React from 'react';
import { Platform } from 'react-native';

import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import {
    readWebHmrOptOutRuntimeState,
    setWebHmrOptOutDisabledForWebTab,
    type WebHmrOptOutRuntimeState,
} from '@/dev/webHmrOptOut/webHmrOptOut';

function isWebDevRuntime(): boolean {
    return Platform.OS === 'web' && (typeof __DEV__ !== 'undefined' ? __DEV__ : false);
}

function readCurrentRuntimeState(): WebHmrOptOutRuntimeState {
    if (typeof window === 'undefined') {
        return readWebHmrOptOutRuntimeState({ sessionStorage: null });
    }

    return readWebHmrOptOutRuntimeState({
        sessionStorage: window.sessionStorage,
        globalTarget: globalThis,
    });
}

function setCurrentRuntimeDisabled(disabled: boolean): WebHmrOptOutRuntimeState {
    if (typeof window === 'undefined') {
        return readWebHmrOptOutRuntimeState({ sessionStorage: null });
    }

    return setWebHmrOptOutDisabledForWebTab({
        disabled,
        sessionStorage: window.sessionStorage,
        globalTarget: globalThis,
    });
}

function reloadCurrentWebTab(): void {
    if (typeof window === 'undefined') {
        return;
    }

    window.location.reload();
}

function describeRuntimeState(state: WebHmrOptOutRuntimeState): string {
    const runtime = state.guardInstalled
        ? t('settings.devWebHmrRuntimeDetected')
        : t('settings.devWebHmrRuntime');
    const status = state.enabled ? t('settings.devWebHmrEnabled') : t('settings.devWebHmrDisabled');
    const reload = state.requiresPageReload ? t('settings.devWebHmrReload') : '';
    return t('settings.devWebHmrSubtitle', { runtime, status, reload });
}

export const WebHmrDevSettingsSection = React.memo(function WebHmrDevSettingsSection() {
    const [state, setState] = React.useState<WebHmrOptOutRuntimeState>(() => readCurrentRuntimeState());

    const setHmrEnabled = React.useCallback((enabled: boolean) => {
        const nextState = setCurrentRuntimeDisabled(!enabled);
        setState(nextState);
        reloadCurrentWebTab();
    }, []);

    if (!isWebDevRuntime() || !state.available) {
        return null;
    }

    return (
        <ItemGroup title={t('settings.devWebHmrTitle')}>
            <Item
                testID="dev-web-hmr-toggle-row"
                title={t('settings.devWebHmrToggleTitle')}
                subtitle={describeRuntimeState(state)}
                rightElement={
                    <Switch
                        testID="dev-web-hmr-toggle"
                        value={state.enabled}
                        onValueChange={setHmrEnabled}
                    />
                }
                showChevron={false}
                onPress={() => setHmrEnabled(!state.enabled)}
            />
        </ItemGroup>
    );
});
