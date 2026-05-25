import type { ProfileProvisionBackendId } from '@/sync/domains/profiles/profileProvisionRpc';
import type { TerminalStatus } from '@/hooks/machine/useMachineTerminalSession';

export type ProfileAuthDisplayState =
    | Readonly<{
        kind: 'waiting';
        backendId: ProfileProvisionBackendId;
        waiting: true;
    }>
    | Readonly<{
        kind: 'login-link';
        backendId: ProfileProvisionBackendId;
        loginUrl: string;
        waiting: false;
    }>
    | Readonly<{
        kind: 'device-code';
        backendId: 'codex';
        loginUrl: string;
        deviceCode: string;
        waiting: false;
    }>;

const ANSI_RE = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\x1B\\))/g;
const CLAUDE_OAUTH_AUTHORIZE_URL_RE = /https:\/\/[^\s]*\/oauth\/authorize[^\s]*/;
const CLAUDE_URL_TRAILING_TEXT_RE = /^(?:Paste|Enter|Esc)\b/i;
const URL_SAFE_SEGMENT_RE = /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/;
const CODEX_DEVICE_CODE_RE = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/;
const CODEX_LOGIN_URL_RE = /https:\/\/[^\s]*(?:auth\.openai\.com|auth0\.openai\.com|accounts\.google\.com)[^\s]*/;

function cleanTerminalOutput(input: string): string {
    return input.replace(ANSI_RE, '').replace(/\r/g, '');
}

function stripAnsiOnly(input: string): string {
    return input.replace(ANSI_RE, '').replace(/\r/g, '\n');
}

function cleanTrailingUiText(url: string): string {
    return url
        .replace(/Paste.*$/, '')
        .replace(/Enter.*$/, '')
        .replace(/Esc.*$/, '')
        .replace(/>+$/, '')
        .replace(/[),.;:]+$/, '');
}

function shouldJoinWrappedClaudeUrlSegment(currentUrl: string, segment: string): boolean {
    if (!segment || CLAUDE_URL_TRAILING_TEXT_RE.test(segment)) return false;
    if (!URL_SAFE_SEGMENT_RE.test(segment)) return false;
    if (segment.startsWith('&') || segment.includes('=')) return true;
    return currentUrl.includes('?') && segment.length >= 8;
}

function extractClaudeOAuthAuthorizeUrl(input: string): string | null {
    const clean = stripAnsiOnly(input);
    const match = clean.match(CLAUDE_OAUTH_AUTHORIZE_URL_RE);
    if (!match || match.index === undefined) return null;

    let url = match[0];
    let cursor = match.index + match[0].length;
    while (cursor < clean.length) {
        const whitespaceMatch = clean.slice(cursor).match(/^\s+/);
        if (!whitespaceMatch) break;

        const segmentStart = cursor + whitespaceMatch[0].length;
        const remaining = clean.slice(segmentStart);
        if (CLAUDE_URL_TRAILING_TEXT_RE.test(remaining)) break;

        const segmentMatch = remaining.match(/^\S+/);
        const segment = segmentMatch?.[0] ?? '';
        if (!shouldJoinWrappedClaudeUrlSegment(url, segment)) break;

        url += segment;
        cursor = segmentStart + segment.length;
    }

    return cleanTrailingUiText(url);
}

function resolveWaiting(params: Readonly<{
    backendId: ProfileProvisionBackendId;
}>): ProfileAuthDisplayState {
    return {
        kind: 'waiting',
        backendId: params.backendId,
        waiting: true,
    };
}

export function resolveProfileAuthDisplayState(params: Readonly<{
    backendId: ProfileProvisionBackendId;
    terminalOutput: string;
    terminalStatus: TerminalStatus;
}>): ProfileAuthDisplayState {
    const clean = cleanTerminalOutput(params.terminalOutput);

    if (params.backendId === 'claude') {
        const loginUrl = extractClaudeOAuthAuthorizeUrl(params.terminalOutput);
        if (!loginUrl) return resolveWaiting(params);
        return {
            kind: 'login-link',
            backendId: 'claude',
            loginUrl,
            waiting: false,
        };
    }

    const urlMatch = clean.match(CODEX_LOGIN_URL_RE);
    if (!urlMatch) return resolveWaiting(params);

    const loginUrl = cleanTrailingUiText(urlMatch[0]);
    const isDeviceFlow = /one-time code|device code/i.test(clean) || /\/device\b/.test(loginUrl);
    const codeMatch = isDeviceFlow ? clean.match(CODEX_DEVICE_CODE_RE) : null;
    if (codeMatch) {
        return {
            kind: 'device-code',
            backendId: 'codex',
            loginUrl,
            deviceCode: codeMatch[0],
            waiting: false,
        };
    }

    return {
        kind: 'login-link',
        backendId: 'codex',
        loginUrl,
        waiting: false,
    };
}
