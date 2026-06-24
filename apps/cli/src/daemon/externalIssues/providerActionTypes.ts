export type ProviderAction = Readonly<{
  id: string;
  issueRefId?: string | null;
  externalIssueRefId?: string | null;
  sessionRunId?: string | null;
  provider?: string | null;
  repositoryKey?: string | null;
  actionKind: string;
  executionMode: string;
  state: string;
  claimedByExecutorId?: string | null;
  payload?: unknown;
  externalIssueRef?: Readonly<{
    id?: string | null;
    issueNumber?: number | null;
    title?: string | null;
    url?: string | null;
  }> | null;
  repositoryConnection?: Readonly<{
    id?: string | null;
    providerBaseUrl?: string | null;
    authKind?: string | null;
  }> | null;
}>;

export type ProviderActionClaimResponse = Readonly<{
  action: ProviderAction | null;
}>;
