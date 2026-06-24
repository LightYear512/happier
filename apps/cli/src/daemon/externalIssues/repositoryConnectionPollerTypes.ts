export type RepositoryConnectionPollerConnection = Readonly<{
  id: string;
  provider: string;
  providerBaseUrl: string;
  repositoryKey: string;
  enabled: boolean;
  pollerEnabled?: boolean | null;
}>;

export type RepositoryConnectionPollerListResponse = Readonly<{
  connections: RepositoryConnectionPollerConnection[];
}>;

export type NormalizedRepositoryProviderEvent = Readonly<{
  eventKey: string;
  occurredAt: number;
  kind: string;
  issueNumber?: number;
  providerChangeExternalId?: string;
  headCommitSha?: string;
  command?: string;
  snapshot?: Record<string, unknown>;
}>;

export type RepositoryConnectionPollerPushResponse = Readonly<{
  recorded: number;
  deduped: number;
  issues: unknown[];
}>;
