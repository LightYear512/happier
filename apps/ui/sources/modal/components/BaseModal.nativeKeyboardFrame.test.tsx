import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { flattenTestStyle } from '@/dev/testkit/harness/popoverHarness';
import { OVERLAY_PORTAL_HOST_Z_INDEX } from '@/components/ui/overlay/overlayStacking';
import { installModalComponentCommonModuleMocks } from './modalComponentTestHelpers';

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/state/storage')>();
    return {
        ...actual,
        useLocalSetting: ((name: string) => {
            if (name === 'uiBackdropBlurEnabled') return true;
            return null;
        }) as typeof import('@/sync/domains/state/storage')['useLocalSetting'],
    };
});

vi.mock('@/components/ui/keyboardAvoidance', () => ({
    KeyboardAwareModalFrame: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('KeyboardAwareModalFrame', props, props.children),
}));

installModalComponentCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'ios',
                select: <T,>(options: { ios?: T; native?: T; default?: T; web?: T; android?: T }) =>
                    options.ios ?? options.native ?? options.default ?? options.web ?? options.android,
            },
        });
    },
});

describe('BaseModal (native keyboard frame)', () => {
    it('routes native modal content through the shared keyboard-aware modal frame', async () => {
        const { BaseModal } = await import('./BaseModal');

        const screen = await renderScreen(
            <BaseModal visible={true}>
                <Child />
            </BaseModal>,
        );

        expect(screen.findByType('KeyboardAwareModalFrame' as any).props.style).toBeDefined();
        expect(screen.findAllByType('KeyboardAvoidingView' as any)).toHaveLength(0);
    });

    it('layers the native portal root above popover portal hosts so nested modals stay selectable on Android', async () => {
        const { BaseModal } = await import('./BaseModal');

        const screen = await renderScreen(
            <BaseModal visible={true}>
                <Child />
            </BaseModal>,
        );

        const portalRoot = screen.tree.root.findAll((node) => {
            const style = flattenTestStyle(node.props?.style);
            return typeof style?.zIndex === 'number'
                && typeof style?.elevation === 'number';
        })[0];

        const portalStyle = flattenTestStyle(portalRoot?.props?.style);
        expect(portalStyle?.zIndex).toBeGreaterThan(OVERLAY_PORTAL_HOST_Z_INDEX);
        expect(portalStyle?.elevation).toBeGreaterThan(OVERLAY_PORTAL_HOST_Z_INDEX);
    });
});

function Child() {
    return React.createElement('Child');
}
