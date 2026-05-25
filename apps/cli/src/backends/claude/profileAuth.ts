import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ensureProfileSymlink } from '@/auth/provision/ensureProfileSymlink';
import { isProfileProvisioned } from '@/auth/provision/isProfileProvisioned';
import { resolveProvisionedProfileDir } from '@/auth/provision/profileProvisionPaths';
import { resolveConfiguredClaudeConfigDir } from '@/backends/claude/utils/resolveConfiguredClaudeConfigDir';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import type {
  CliProfileAuthProvider,
  CliProfileAuthTerminalOutputResponder,
} from '@/backends/types';

const CLAUDE_PROFILE_AUTH_ENV_KEY = 'CLAUDE_CONFIG_DIR';
const CLAUDE_OAUTH_AUTHORIZE_URL_PATTERN = /https:\/\/[^\s]*\/oauth\/authorize[^\s]*/;

type ClaudePromptId = 'login-method' | 'trust-folder' | 'text-style';
type ClaudePromptDefinition = Readonly<{
  id: ClaudePromptId;
  matches: readonly string[];
  response: string;
}>;

const CLAUDE_INTERACTIVE_PROMPTS: readonly ClaudePromptDefinition[] = [
  { id: 'login-method', matches: ['Select login method'], response: '\r' },
  { id: 'trust-folder', matches: ['Do you trust the files in this folder?', 'trust this folder'], response: '\r' },
  { id: 'text-style', matches: ['Choose the text style'], response: '2\r' },
];

function cleanClaudeTerminalOutput(input: string): string {
  return input
    .replace(/\u001B\[[\d;]*[HABEFf]/g, '\n')
    .replace(/\u001B\[[\d;]*[CG]/g, ' ')
    .replace(/\u001B\[[\d;]*D/g, '')
    .replace(/\u001B\[[\x20-\x3F]*[\x30-\x3F]*[\x40-\x7E]/g, '')
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B[P^_][^\u001B]*\u001B\\/g, '')
    .replace(/\u001B[()][A-Z0-9]/g, '')
    .replace(/\u001B[>=<#]/g, '')
    .replace(/\u001B./g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┘├┤┬┴┼╋╌╍╎╏═║╔╗╚╝╟╠╡╢╣╤╥╦╧╨╩╪╫╬▀▁▂▃▄▅▆▇█▉▊▋▌▍▎▏▐░▒▓▔▕╭╮╯╰╱╲╳╴╵╶╷╸╹╺╻╼╽╾╿·•…‥‧]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function stripClaudeAnsiOnly(input: string): string {
  return input
    .replace(/\u001B\[[^A-Za-z]*[A-Za-z]/g, '')
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B[P^_][^\u001B]*\u001B\\/g, '')
    .replace(/\u001B./g, '')
    .replace(/\r/g, '');
}

function resolveClaudePromptResponse(
  output: string,
  handledPromptIds: Set<ClaudePromptId>,
): Readonly<{ id: ClaudePromptId; response: string }> | null {
  for (const prompt of CLAUDE_INTERACTIVE_PROMPTS) {
    if (handledPromptIds.has(prompt.id)) continue;
    if (prompt.matches.some((match) => output.includes(match))) {
      return { id: prompt.id, response: prompt.response };
    }
  }
  return null;
}

function createClaudeProfileAuthOutputResponder(): CliProfileAuthTerminalOutputResponder {
  let loginCommandSent = false;
  const handledPromptIds = new Set<ClaudePromptId>();

  return ({ outputBuffer }) => {
    const cleanOutput = cleanClaudeTerminalOutput(outputBuffer);
    if (CLAUDE_OAUTH_AUTHORIZE_URL_PATTERN.test(stripClaudeAnsiOnly(outputBuffer))) return null;

    if (!loginCommandSent && (cleanOutput.includes('Not logged in') || cleanOutput.includes('Welcome back'))) {
      loginCommandSent = true;
      return '/login\r';
    }

    const promptResponse = resolveClaudePromptResponse(cleanOutput, handledPromptIds);
    if (promptResponse) {
      handledPromptIds.add(promptResponse.id);
      return promptResponse.response;
    }

    return null;
  };
}

function ensureClaudeSharedConfigLinks(params: Readonly<{
  globalConfigDir: string;
  profileDir: string;
}>): void {
  for (const entry of [
    { name: 'projects', targetKind: 'directory' as const },
    { name: 'skills', targetKind: 'directory' as const },
    { name: 'agents', targetKind: 'directory' as const },
    { name: 'commands', targetKind: 'directory' as const },
  ]) {
    ensureProfileSymlink({
      target: join(params.globalConfigDir, entry.name),
      linkPath: join(params.profileDir, entry.name),
      targetKind: entry.targetKind,
    });
  }

  ensureProfileSymlink({
    target: join(params.globalConfigDir, 'settings.json'),
    linkPath: join(params.profileDir, 'settings.json'),
    targetKind: 'file',
    createMissingFileContent: '{}',
  });
}

function buildClaudeProfileAuthEnv(params: Readonly<{
  processEnv: NodeJS.ProcessEnv;
  profileDir: string;
}>): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...params.processEnv,
    [CLAUDE_PROFILE_AUTH_ENV_KEY]: params.profileDir,
  };
  delete childEnv.HAPPIER_CLAUDE_CONFIG_DIR;
  return childEnv;
}

export const claudeProfileAuthProvider: CliProfileAuthProvider = {
  providerId: 'claude',
  buildProfileDir: ({ activeServerDir, profileId }) => resolveProvisionedProfileDir({
    activeServerDir,
    backendId: 'claude',
    profileId,
  }),
  prepareProfileDir: ({ activeServerDir, profileId, processEnv = process.env }) => {
    const profileDir = claudeProfileAuthProvider.buildProfileDir({ activeServerDir, profileId });
    const createdByThisRun = !existsSync(profileDir);
    mkdirSync(profileDir, { recursive: true });
    ensureClaudeSharedConfigLinks({
      globalConfigDir: resolveConfiguredClaudeConfigDir({ env: processEnv }),
      profileDir,
    });
    return { profileDir, createdByThisRun };
  },
  buildIsolatedLoginContext: ({ profileDir, processEnv = process.env }) => {
    const launchSpec = requireProviderCliLaunchSpec('claude', { processEnv });
    return {
      command: launchSpec.command,
      args: launchSpec.args,
      terminalOutputResponder: createClaudeProfileAuthOutputResponder(),
      env: buildClaudeProfileAuthEnv({ processEnv, profileDir }),
      allowlistedEnvKeys: [CLAUDE_PROFILE_AUTH_ENV_KEY],
    };
  },
  isProfileProvisioned: ({ activeServerDir, profileId }) => (
    isProfileProvisioned(profileId, 'claude', activeServerDir)
  ),
  cleanupFailedPrepare: ({ profileDir, createdByThisRun }) => {
    if (!createdByThisRun) return;
    rmSync(profileDir, { recursive: true, force: true });
  },
};

export const __test_claudeProfileAuth = {
  ensureClaudeSharedConfigLinks,
  buildClaudeProfileAuthEnv,
  createClaudeProfileAuthOutputResponder,
};
