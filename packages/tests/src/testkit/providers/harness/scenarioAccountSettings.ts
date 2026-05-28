import { upsertEncryptedAccountSettingsV2 } from '../../accountSettings';

export type ScenarioAccountSettingsContext = Readonly<{
  workspaceDir: string;
  cliHome: string;
}>;

export type ScenarioAccountSettings =
  | unknown
  | ((ctx: ScenarioAccountSettingsContext) => unknown);

export type ScenarioAccountSettingsUpsert = typeof upsertEncryptedAccountSettingsV2;

export async function seedScenarioAccountSettings(params: {
  scenario: Readonly<{
    accountSettings?: ScenarioAccountSettings;
  }>;
  baseUrl: string;
  token: string;
  secret: Uint8Array;
  workspaceDir: string;
  cliHome: string;
  upsert?: ScenarioAccountSettingsUpsert;
}): Promise<boolean> {
  const rawSettings = params.scenario.accountSettings;
  if (typeof rawSettings === 'undefined') {
    return false;
  }

  const settings =
    typeof rawSettings === 'function'
      ? rawSettings({ workspaceDir: params.workspaceDir, cliHome: params.cliHome })
      : rawSettings;

  await (params.upsert ?? upsertEncryptedAccountSettingsV2)({
    baseUrl: params.baseUrl,
    token: params.token,
    secret: params.secret,
    settings,
  });

  return true;
}
