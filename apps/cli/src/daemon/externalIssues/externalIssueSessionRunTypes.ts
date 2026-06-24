export type ExternalIssueSessionRun = Readonly<{
  id: string;
  sessionId: string;
  generation: number;
  state: string;
}>;

export type ExternalIssueSessionRunDetail = Readonly<{
  run: ExternalIssueSessionRun;
  session: Readonly<{
    id: string;
    metadata?: unknown;
  }> | null;
  repositoryConnection?: Readonly<{
    id: string;
    capabilities?: unknown;
  }> | null;
  externalIssue?: Readonly<{
    issueNumber?: number | null;
    title?: string | null;
    url?: string | null;
  }> | null;
}>;

export type ExternalIssueSessionRunClaimResponse = Readonly<{
  run: ExternalIssueSessionRun | null;
}>;
