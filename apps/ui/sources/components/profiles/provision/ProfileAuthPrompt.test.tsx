import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { pressTestInstance, renderScreen } from '@/dev/testkit';
import { ProfileAuthPrompt } from './ProfileAuthPrompt';

type PassthroughProps = Readonly<Record<string, unknown> & { children?: React.ReactNode }>;

function passthrough(typeName: string) {
    return (props: PassthroughProps) => React.createElement(typeName, props, props.children);
}

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: 'View',
        Text: 'Text',
        Pressable: 'Pressable',
        Platform: { OS: 'web', select: (spec: any) => spec?.web ?? spec?.default },
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

vi.mock('@/components/ui/buttons/RoundButton', () => ({
    RoundButton: passthrough('RoundButton'),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: passthrough('Text'),
}));

type RenderedNode = Readonly<{
    props: Readonly<{
        children?: React.ReactNode;
        numberOfLines?: unknown;
        testID?: unknown;
        title?: unknown;
    }>;
    findAll: (predicate: (node: RenderedNode) => boolean) => RenderedNode[];
}>;

describe('ProfileAuthPrompt', () => {
    it('renders Claude as a login-link prompt without a device code', async () => {
        const screen = await renderScreen(
            <ProfileAuthPrompt
                backendId="claude"
                displayState={{
                    kind: 'login-link',
                    backendId: 'claude',
                    loginUrl: 'https://claude.ai/oauth/authorize?code=true',
                    waiting: false,
                }}
                showDetails={false}
                onCopy={vi.fn()}
                onOpen={vi.fn()}
                onToggleDetails={vi.fn()}
            />,
        );

        expect(screen.findByTestId('profile-provision-login-url')).not.toBeNull();
        expect(screen.findByTestId('profile-provision-device-code')).toBeNull();
    });

    it('does not clamp the Claude login URL text', async () => {
        const loginUrl = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload&code_challenge=CV_dqhE_tZEUtNl67dD1AUj5RkYeaMou-3HC6HQqO4A&code_challenge_method=S256&state=i-jPoLvHQmXglTwVvr9vmp9CCsIISFDPa71Uq4E5z0M';
        const screen = await renderScreen(
            <ProfileAuthPrompt
                backendId="claude"
                displayState={{
                    kind: 'login-link',
                    backendId: 'claude',
                    loginUrl,
                    waiting: false,
                }}
                showDetails={false}
                onCopy={vi.fn()}
                onOpen={vi.fn()}
                onToggleDetails={vi.fn()}
            />,
        );

        const urlBox = screen.findByTestId('profile-provision-login-url') as unknown as RenderedNode;
        const [urlText] = urlBox.findAll((node) => node.props.children === loginUrl);
        expect(urlText?.props.numberOfLines).toBeUndefined();
    });

    it('renders Codex device code and copies only the requested value', async () => {
        const onCopy = vi.fn();
        const screen = await renderScreen(
            <ProfileAuthPrompt
                backendId="codex"
                displayState={{
                    kind: 'device-code',
                    backendId: 'codex',
                    loginUrl: 'https://auth.openai.com/codex/device',
                    deviceCode: 'ABCD-EFGH',
                    waiting: false,
                }}
                showDetails={false}
                onCopy={onCopy}
                onOpen={vi.fn()}
                onToggleDetails={vi.fn()}
            />,
        );

        expect(screen.findByTestId('profile-provision-device-code')).not.toBeNull();
        pressTestInstance(screen.findByTestId('profile-provision-copy-code'), 'Copy Code');
        expect(onCopy).toHaveBeenCalledWith('ABCD-EFGH');
    });

    it('orders Codex device actions as open URL, copy URL, then copy code', async () => {
        const screen = await renderScreen(
            <ProfileAuthPrompt
                backendId="codex"
                displayState={{
                    kind: 'device-code',
                    backendId: 'codex',
                    loginUrl: 'https://auth.openai.com/codex/device',
                    deviceCode: 'ABCD-EFGH',
                    waiting: false,
                }}
                showDetails={false}
                onCopy={vi.fn()}
                onOpen={vi.fn()}
                onToggleDetails={vi.fn()}
            />,
        );

        const prompt = screen.findByTestId('profile-provision-auth-prompt') as unknown as RenderedNode;
        const seenTestIds = new Set<unknown>();
        const actionTitles = prompt
            .findAll((node) => typeof node.props.testID === 'string' && typeof node.props.title === 'string')
            .filter((node) => {
                if (seenTestIds.has(node.props.testID)) return false;
                seenTestIds.add(node.props.testID);
                return true;
            })
            .map((node) => node.props.title);
        expect(actionTitles).toEqual(['common.open', 'Copy URL', 'Copy Code']);
    });
});
