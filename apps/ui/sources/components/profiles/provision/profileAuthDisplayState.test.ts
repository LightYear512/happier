import { describe, expect, it } from 'vitest';

import { resolveProfileAuthDisplayState } from './profileAuthDisplayState';

const FULL_CLAUDE_OAUTH_URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload&code_challenge=CV_dqhE_tZEUtNl67dD1AUj5RkYeaMou-3HC6HQqO4A&code_challenge_method=S256&state=i-jPoLvHQmXglTwVvr9vmp9CCsIISFDPa71Uq4E5z0M';

describe('resolveProfileAuthDisplayState', () => {
    it('extracts only the Claude OAuth login URL from noisy PTY output', () => {
        expect(resolveProfileAuthDisplayState({
            backendId: 'claude',
            terminalOutput: [
                '\u001B[2JWelcome back',
                'Choose the text style',
                'Open https://claude.ai/oauth/authorize?client_id=abc&code=true Paste the code here',
            ].join('\n'),
            terminalStatus: 'connected',
        })).toEqual({
            kind: 'login-link',
            backendId: 'claude',
            loginUrl: 'https://claude.ai/oauth/authorize?client_id=abc&code=true',
            waiting: false,
        });
    });

    it('preserves the full Claude OAuth URL when PTY output wraps it across lines', () => {
        const wrappedUrl = FULL_CLAUDE_OAUTH_URL
            .replace('&response_type=', '\n&response_type=')
            .replace('&code_challenge_method=', '\n&code_challenge_method=');

        expect(resolveProfileAuthDisplayState({
            backendId: 'claude',
            terminalOutput: [
                '\u001B[2JWelcome back',
                'Choose the text style',
                `Open ${wrappedUrl} Paste the code here`,
            ].join('\n'),
            terminalStatus: 'connected',
        })).toEqual({
            kind: 'login-link',
            backendId: 'claude',
            loginUrl: FULL_CLAUDE_OAUTH_URL,
            waiting: false,
        });
    });

    it('extracts the Codex device URL and one-time code', () => {
        expect(resolveProfileAuthDisplayState({
            backendId: 'codex',
            terminalOutput: [
                'To sign in, open https://auth.openai.com/codex/device',
                'Then enter this one-time code:',
                'ABCD-EFGH',
            ].join('\n'),
            terminalStatus: 'connected',
        })).toEqual({
            kind: 'device-code',
            backendId: 'codex',
            loginUrl: 'https://auth.openai.com/codex/device',
            deviceCode: 'ABCD-EFGH',
            waiting: false,
        });
    });

    it('keeps waiting state before provider login details are visible', () => {
        expect(resolveProfileAuthDisplayState({
            backendId: 'codex',
            terminalOutput: 'Starting Codex login...',
            terminalStatus: 'connected',
        })).toEqual({
            kind: 'waiting',
            backendId: 'codex',
            waiting: true,
        });
    });
});
