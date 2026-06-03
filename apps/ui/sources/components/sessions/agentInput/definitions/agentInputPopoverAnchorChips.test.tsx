import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props),
}));

describe('agent input popover anchor chips', () => {
    it('keeps the machine chip native anchor measurable for content popovers', async () => {
        const { createMachineActionChip } = await import('./createMachineActionChip');

        const screen = await renderScreen(
            <React.Fragment>
                {createMachineActionChip({
                    anchorRef: { current: null },
                    machineName: 'Builder',
                    tint: '#111',
                    showLabel: true,
                    chipStyle: () => ({}),
                    textStyle: {},
                    onPress: vi.fn(),
                })}
            </React.Fragment>,
        );

        expect(screen.findByTestId('agent-input-machine-chip')?.props.collapsable).toBe(false);
    });

    it('keeps collapsed content chips native anchors measurable for content popovers', async () => {
        const { createMcpActionChip } = await import('./createMcpActionChip');

        const chip = createMcpActionChip({
            label: 'MCP',
            selectedCount: 0,
            popoverContent: React.createElement('View'),
        });

        const screen = await renderScreen(
            <React.Fragment>
                {chip.render({
                    chipStyle: () => ({}),
                    showLabel: true,
                    iconColor: '#111',
                    textStyle: {},
                    countTextStyle: {},
                    chipAnchorRef: { current: null },
                    popoverAnchorRef: { current: null },
                    toggleCollapsedPopover: vi.fn(),
                })}
            </React.Fragment>,
        );

        expect(screen.findByTestId('new-session-mcp-chip')?.props.collapsable).toBe(false);
    });
});
