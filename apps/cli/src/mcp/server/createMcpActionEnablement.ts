import {
  getActionSpec,
  isActionEnabledByActionsSettings,
  isApprovalRequiredByActionsSettings,
  type AccountSettings,
  type ActionId,
  type ActionSurfaces,
} from '@happier-dev/protocol';

import { resolveCliFeatureDecision } from '@/features/featureDecisionService';
import { isActionApprovalRequiredByEnv, isActionEnabledByEnv } from '@/settings/actionsSettings';

export function createMcpActionEnablement(params: Readonly<{
  accountSettings?: AccountSettings | null;
  surface: keyof ActionSurfaces;
}>): (id: ActionId) => boolean {
  const actionsSettings = params.accountSettings?.actionsSettingsV1 ?? null;
  return (id) => {
    const actionEnabled = actionsSettings
      ? isActionEnabledByActionsSettings(id, actionsSettings, {
        surface: params.surface,
        placement: null,
      })
      : isActionEnabledByEnv(id, { surface: params.surface });
    if (!actionEnabled) return false;

    const requiredFeatureId = getActionSpec(id).requiredFeatureId;
    if (!requiredFeatureId) return true;

    return resolveCliFeatureDecision({
      featureId: requiredFeatureId,
      env: process.env,
      accountSettings: params.accountSettings ?? null,
    }).state === 'enabled';
  };
}

export function createMcpActionApprovalRequirement(params: Readonly<{
  accountSettings?: AccountSettings | null;
  surface: keyof ActionSurfaces;
}>): (id: ActionId) => boolean {
  const actionsSettings = params.accountSettings?.actionsSettingsV1 ?? null;
  if (actionsSettings) {
    return (id) => isApprovalRequiredByActionsSettings(id, actionsSettings, {
      surface: params.surface,
    });
  }

  return (id) => isActionApprovalRequiredByEnv(id, { surface: params.surface });
}
