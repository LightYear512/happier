import axios from 'axios';

import type {
  NormalizedRepositoryProviderEvent,
  RepositoryConnectionPollerConnection,
} from './repositoryConnectionPollerTypes';

type GitHubIssueApiRecord = Readonly<{
  id?: unknown;
  number?: unknown;
  title?: unknown;
  state?: unknown;
  html_url?: unknown;
  updated_at?: unknown;
  labels?: unknown;
  assignees?: unknown;
  pull_request?: unknown;
}>;

function normalizeProviderBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function resolveGitHubApiBaseUrl(providerBaseUrl: string): string {
  const normalized = normalizeProviderBaseUrl(providerBaseUrl);
  if (normalized === 'https://github.com') {
    return 'https://api.github.com';
  }
  return `${normalized}/api/v3`;
}

function githubAuthHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const token = env.HAPPIER_EXTERNAL_ISSUE_GITHUB_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  return {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function readStringArrayFromGitHubNamedRecords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (!entry || typeof entry !== 'object') return [];
    const name = (entry as { name?: unknown; login?: unknown }).name
      ?? (entry as { name?: unknown; login?: unknown }).login;
    return typeof name === 'string' && name.trim().length > 0 ? [name] : [];
  });
}

function normalizeGitHubIssue(connection: RepositoryConnectionPollerConnection, issue: GitHubIssueApiRecord): NormalizedRepositoryProviderEvent | null {
  if (issue.pull_request !== undefined) return null;
  if (typeof issue.number !== 'number' || !Number.isInteger(issue.number) || issue.number <= 0) return null;
  if (typeof issue.updated_at !== 'string' || Number.isNaN(Date.parse(issue.updated_at))) return null;

  const state = typeof issue.state === 'string' && issue.state.trim().length > 0 ? issue.state : 'open';
  const title = typeof issue.title === 'string' && issue.title.trim().length > 0 ? issue.title : `Issue #${issue.number}`;
  const url = typeof issue.html_url === 'string' && issue.html_url.trim().length > 0 ? issue.html_url : undefined;
  const providerIssueExternalId = typeof issue.id === 'number' ? String(issue.id) : undefined;

  return {
    eventKey: `github:${connection.repositoryKey}:issue:${issue.number}:${issue.updated_at}`,
    occurredAt: Date.parse(issue.updated_at),
    kind: 'issue_snapshot',
    issueNumber: issue.number,
    snapshot: {
      title,
      state,
      ...(url ? { url } : {}),
      labels: readStringArrayFromGitHubNamedRecords(issue.labels),
      assignees: readStringArrayFromGitHubNamedRecords(issue.assignees),
      ...(providerIssueExternalId ? { providerIssueExternalId } : {}),
    },
  };
}

async function fetchGitHubIssueSnapshots(params: {
  connection: RepositoryConnectionPollerConnection;
  env: NodeJS.ProcessEnv;
}): Promise<NormalizedRepositoryProviderEvent[]> {
  const repositorySegments = params.connection.repositoryKey.split('/').filter(Boolean);
  if (repositorySegments.length !== 2) {
    return [];
  }

  const [owner, repo] = repositorySegments.map(encodeURIComponent);
  const url = new URL(`${resolveGitHubApiBaseUrl(params.connection.providerBaseUrl)}/repos/${owner}/${repo}/issues`);
  url.searchParams.set('state', 'open');
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('direction', 'desc');
  url.searchParams.set('per_page', '50');

  const response = await axios.get<unknown>(url.toString(), {
    headers: githubAuthHeaders(params.env),
    timeout: 15_000,
  });
  if (!Array.isArray(response.data)) {
    return [];
  }

  return response.data.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const normalized = normalizeGitHubIssue(params.connection, raw as GitHubIssueApiRecord);
    return normalized ? [normalized] : [];
  });
}

export async function fetchRepositoryConnectionProviderEvents(params: {
  connection: RepositoryConnectionPollerConnection;
  env?: NodeJS.ProcessEnv;
}): Promise<NormalizedRepositoryProviderEvent[]> {
  const env = params.env ?? process.env;
  if (params.connection.provider === 'github') {
    return await fetchGitHubIssueSnapshots({
      connection: params.connection,
      env,
    });
  }
  return [];
}
