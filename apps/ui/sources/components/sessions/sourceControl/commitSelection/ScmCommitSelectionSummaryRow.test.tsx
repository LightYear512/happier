import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { pressTestInstance, renderScreen } from '@/dev/testkit';
import { createThemeFixture } from '@/dev/testkit/fixtures/themeFixtures';
import { createReactNativeWebMock } from '@/dev/testkit/mocks/reactNative';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';

import { installSourceControlCommitSelectionCommonModuleMocks } from './sourceControlCommitSelectionTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__DEV__ = false;

installSourceControlCommitSelectionCommonModuleMocks({
    reactNative: async () =>
        createReactNativeWebMock({
            View: 'View',
            Pressable: 'Pressable',
            Platform: {
                OS: 'ios',
                select: (s: any) => s.ios ?? s.default,
            },
    }),
    typography: async () => ({
        Typography: {
            default: () => ({}),
            eyebrow: () => ({}),
            keyHint: () => ({}),
            mono: () => ({}),
        },
    }),
    text: async () =>
        createTextModuleMock({
            translate: (_k: string, vars?: any) =>
                vars?.count != null ? `selected:${vars.count}` : 'clear',
        }),
});

describe('ScmCommitSelectionSummaryRow', () => {
  it('renders and calls onClear', async () => {
    const { ScmCommitSelectionSummaryRow } = await import('./ScmCommitSelectionSummaryRow');
    const onClear = vi.fn();

    const theme = createThemeFixture({
      colors: {
        border: { default: '#ddd', surface: '#ddd' },
        divider: '#ddd',
        surface: { base: '#fff', inset: '#f5f5f5', elevated: '#fff' },
        surfaceHigh: '#f5f5f5',
        input: { background: '#f5f5f5' },
        text: { primary: '#111', secondary: '#666', link: '#00f' },
        textSecondary: '#666',
        textLink: '#00f',
      },
    });

    const screen = await renderScreen(
      <ScmCommitSelectionSummaryRow theme={theme} count={3} onClear={onClear} density="compact" />,
    );
    pressTestInstance(screen.findByProps({ accessibilityRole: 'button' }), 'files.clearSelection');

    expect(onClear).toHaveBeenCalled();
  });
});
