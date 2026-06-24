import axios from 'axios';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ProviderAction } from './providerActionTypes';
import { ProviderActionExecutionError } from './providerActionExecutionError';

const execFileAsync = promisify(execFile);

type GitHubCommentResponse = Readonly<{
  id?: unknown;
  html_url?: unknown;
}>;

function normalizeProviderBaseUrl(value: string | null | undefined): string {
  const normalized = String(value ?? 'https://github.com').trim().replace(/\/+$/, '');
  return normalized.length > 0 ? normalized : 'https://github.com';
}

function resolveGitHubApiBaseUrl(providerBaseUrl: string): string {
  const normalized = normalizeProviderBaseUrl(providerBaseUrl);
  if (normalized === 'https://github.com') {
    return 'https://api.github.com';
  }
  return `${normalized}/api/v3`;
}

function resolveGitHubHostname(providerBaseUrl: string): string | null {
  const normalized = normalizeProviderBaseUrl(providerBaseUrl);
  if (normalized === 'https://github.com') return null;
  try {
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}

function readPayloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveRepositoryParts(repositoryKey: string | null | undefined): [string, string] {
  const parts = String(repositoryKey ?? '').split('/').filter((part) => part.trim().length > 0);
  if (parts.length !== 2) {
    throw new ProviderActionExecutionError({
      errorCode: 'invalid_repository_key',
      message: 'GitHub issue link-back requires an owner/repo repository key.',
      retryRecommended: false,
    });
  }
  return [parts[0]!, parts[1]!];
}

function resolveIssueNumber(action: ProviderAction): number {
  const issueNumber = action.externalIssueRef?.issueNumber;
  if (typeof issueNumber !== 'number' || !Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new ProviderActionExecutionError({
      errorCode: 'missing_issue_number',
      message: 'GitHub issue link-back requires an external issue number.',
      retryRecommended: false,
    });
  }
  return issueNumber;
}

function resolveGitHubToken(env: NodeJS.ProcessEnv): string | null {
  return env.HAPPIER_EXTERNAL_ISSUE_GITHUB_TOKEN?.trim()
    || env.GITHUB_TOKEN?.trim()
    || env.GH_TOKEN?.trim()
    || null;
}

function shouldDryRunProviderAction(env: NodeJS.ProcessEnv): boolean {
  return env.HAPPIER_EXTERNAL_ISSUE_PROVIDER_ACTION_DRY_RUN === '1';
}

function buildLinkBackBody(action: ProviderAction): string {
  const payload = readPayloadObject(action.payload);
  const changeUrl = readNonEmptyString(payload.providerChangeUrl);
  const changeNumber = typeof payload.providerChangeNumber === 'number'
    ? `#${payload.providerChangeNumber}`
    : null;
  const changeLabel = changeUrl
    ? `${changeNumber ? `${changeNumber}: ` : ''}${changeUrl}`
    : 'the completed provider change';

  return [
    'Happier completed an automated run for this issue.',
    '',
    `Change: ${changeLabel}`,
  ].join('\n');
}

function readCommentExternalId(response: GitHubCommentResponse): string | undefined {
  if (typeof response.id === 'number' || typeof response.id === 'string') {
    return `github-comment-${String(response.id)}`;
  }
  const htmlUrl = readNonEmptyString(response.html_url);
  return htmlUrl ?? undefined;
}

async function createGitHubCommentWithToken(params: {
  action: ProviderAction;
  env: NodeJS.ProcessEnv;
  body: string;
}): Promise<string | undefined> {
  const token = resolveGitHubToken(params.env);
  if (!token) return undefined;

  const [owner, repo] = resolveRepositoryParts(params.action.repositoryKey);
  const issueNumber = resolveIssueNumber(params.action);
  const providerBaseUrl = normalizeProviderBaseUrl(params.action.repositoryConnection?.providerBaseUrl);
  const response = await axios.post<GitHubCommentResponse>(
    `${resolveGitHubApiBaseUrl(providerBaseUrl)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`,
    { body: params.body },
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 15_000,
    },
  );
  return readCommentExternalId(response.data);
}

async function createGitHubCommentWithGhCli(params: {
  action: ProviderAction;
  body: string;
}): Promise<string | undefined> {
  if (params.action.repositoryConnection?.authKind !== 'gh_cli') {
    return undefined;
  }

  const [owner, repo] = resolveRepositoryParts(params.action.repositoryKey);
  const issueNumber = resolveIssueNumber(params.action);
  const providerBaseUrl = normalizeProviderBaseUrl(params.action.repositoryConnection?.providerBaseUrl);
  const hostname = resolveGitHubHostname(providerBaseUrl);
  const args = [
    'api',
    `repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    '--method',
    'POST',
    '--header',
    'Accept: application/vnd.github+json',
    '-f',
    `body=${params.body}`,
    ...(hostname ? ['--hostname', hostname] : []),
  ];
  const result = await execFileAsync('gh', args, {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  try {
    const parsed = JSON.parse(String(result.stdout || '{}')) as GitHubCommentResponse;
    return readCommentExternalId(parsed);
  } catch {
    return undefined;
  }
}

export async function writeGitHubIssueLinkBack(params: {
  action: ProviderAction;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  providerExternalId?: string;
  summary: string;
}> {
  const env = params.env ?? process.env;
  if (shouldDryRunProviderAction(env)) {
    resolveRepositoryParts(params.action.repositoryKey);
    resolveIssueNumber(params.action);
    return {
      providerExternalId: `github-link-back-dry-run:${params.action.id}`,
      summary: 'GitHub issue link-back dry run completed without provider write.',
    };
  }

  const body = buildLinkBackBody(params.action);
  const providerExternalId = await createGitHubCommentWithToken({
    action: params.action,
    env,
    body,
  }) ?? await createGitHubCommentWithGhCli({
    action: params.action,
    body,
  });

  if (!providerExternalId) {
    throw new ProviderActionExecutionError({
      errorCode: 'missing_provider_credentials',
      message: 'GitHub issue link-back requires HAPPIER_EXTERNAL_ISSUE_GITHUB_TOKEN, GITHUB_TOKEN, GH_TOKEN, or gh CLI authentication.',
      retryRecommended: false,
    });
  }

  return {
    providerExternalId,
    summary: 'GitHub issue comment created for provider change link-back.',
  };
}
