export type RepositoryConnectionCheckout = Readonly<{
  id: string;
  provider: string;
  providerBaseUrl: string;
  repositoryKey: string;
  enabled: boolean;
}>;

export type RepositoryConnectionCheckoutListResponse = Readonly<{
  connections: readonly RepositoryConnectionCheckout[];
}>;

export type LocalRepositoryCheckout = Readonly<{
  localCheckoutPath: string;
  providerBaseUrl: string;
  repositoryKey: string;
}>;
