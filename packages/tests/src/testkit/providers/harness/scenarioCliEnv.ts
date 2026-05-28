import type { ProviderScenario } from '../types';

export type ScenarioCliEnvContext = Readonly<{
  workspaceDir: string;
  cliHome: string;
}>;

export type ScenarioCliEnv = Record<string, string> | ((ctx: ScenarioCliEnvContext) => Record<string, string>);

export function resolveScenarioCliEnv(params: {
  scenario: Pick<ProviderScenario, 'cliEnv'>;
  workspaceDir: string;
  cliHome: string;
}): Record<string, string> {
  const rawEnv = params.scenario.cliEnv;
  if (!rawEnv) return {};

  const resolved = typeof rawEnv === 'function'
    ? rawEnv({ workspaceDir: params.workspaceDir, cliHome: params.cliHome })
    : rawEnv;

  return Object.fromEntries(
    Object.entries(resolved)
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
}
