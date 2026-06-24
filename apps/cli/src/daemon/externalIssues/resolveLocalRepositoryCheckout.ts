import path from 'node:path';

import { runScmCommand } from '@/scm/runtime';
import { defaultScmHostingProviderRegistry } from '@/scm/hostingProviders/registry';
import { stripTrailingSlash } from '@/scm/hostingProviders/remoteUrl';
import { normalizeSpawnSessionDirectory } from '@/rpc/handlers/spawnSessionOptionsContract';
import type { LocalRepositoryCheckout } from './repositoryConnectionCheckoutTypes';

type GitCommandRunner = (input: {
  cwd: string;
  args: string[];
  timeoutMs?: number;
}) => Promise<{ success: boolean; stdout: string }>;

const DEFAULT_GIT_TIMEOUT_MS = 5_000;

const defaultRunGitCommand: GitCommandRunner = async (input) => runScmCommand({
  bin: 'git',
  cwd: input.cwd,
  args: input.args,
  timeoutMs: input.timeoutMs,
});

function readNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

async function readGitOutput(params: {
  cwd: string;
  args: string[];
  runGit: GitCommandRunner;
}): Promise<string | null> {
  const result = await params.runGit({
    cwd: params.cwd,
    args: params.args,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
  if (!result.success) return null;
  return readNonEmpty(result.stdout);
}

export async function resolveLocalRepositoryCheckout(params: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  runGit?: GitCommandRunner;
} = {}): Promise<LocalRepositoryCheckout | null> {
  const env = params.env ?? process.env;
  const runGit = params.runGit ?? defaultRunGitCommand;
  const explicitPath = readNonEmpty(env.HAPPIER_EXTERNAL_ISSUE_CHECKOUT_PATH);
  const identityRepositoryKey = readNonEmpty(env.HAPPIER_EXTERNAL_ISSUE_REPOSITORY_KEY);
  const identityProviderBaseUrl = readNonEmpty(env.HAPPIER_EXTERNAL_ISSUE_PROVIDER_BASE_URL);
  const initialCwd = explicitPath
    ? normalizeSpawnSessionDirectory(explicitPath, env)
    : params.cwd ?? process.cwd();

  const gitRoot = await readGitOutput({
    cwd: initialCwd,
    args: ['rev-parse', '--show-toplevel'],
    runGit,
  });
  const localCheckoutPath = path.resolve(gitRoot ?? initialCwd);
  if (identityRepositoryKey && identityProviderBaseUrl) {
    return {
      localCheckoutPath,
      providerBaseUrl: stripTrailingSlash(identityProviderBaseUrl),
      repositoryKey: identityRepositoryKey,
    };
  }

  const remoteUrl = await readGitOutput({
    cwd: localCheckoutPath,
    args: ['config', '--get', 'remote.origin.url'],
    runGit,
  });
  if (!remoteUrl) return null;

  const provider = defaultScmHostingProviderRegistry.detectRemote({
    remoteName: 'origin',
    remoteUrl,
  });
  if (!provider?.nameWithOwner) return null;

  return {
    localCheckoutPath,
    providerBaseUrl: stripTrailingSlash(provider.baseUrl),
    repositoryKey: provider.nameWithOwner,
  };
}
