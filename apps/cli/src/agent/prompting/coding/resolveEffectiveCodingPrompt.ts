import {
  type AccountSettings,
  buildCodingSessionPromptPlanBaseV1,
  buildPromptPlanDiagnosticsV1,
  buildPromptPlanV1,
  renderPromptPlanV1,
  type PromptBlockV1,
  type PromptPlanV1,
} from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import { resolveCliMemoryRecallGuidanceEnabled } from '@/agent/promptLibrary/resolveCliMemoryRecallGuidanceEnabled';
import { resolveCliFeatureDecision } from '@/features/featureDecisionService';
import { trimIdent } from '@/utils/trimIdent';
import {
  resolveCliPromptStackSystemAppendBlocks,
  type PromptArtifactRecord,
} from '@/agent/promptLibrary/resolveCliPromptStackSystemAppendBlocks';
import { resolveCodingProviderBehaviorBlocks } from './providerPromptBehaviorRegistry';
import { resolveCodingToolDeliveryBlocks } from './toolDeliveryPromptRegistry';

type FetchPromptArtifactRecord = (artifactId: string) => Promise<PromptArtifactRecord | null>;
export type { PromptArtifactRecord };

const DEV_PREVIEW_PROMPT_GUIDANCE = trimIdent(`
  Local dev preview:
  - After starting a local web dev server, register it with \`happier_dev_preview_register\` once you know the local URL so the user can view it in Happier.
  - Do this after commands such as \`npm run dev\`, \`yarn dev\`, \`pnpm dev\`, \`bun dev\`, \`vite\`, \`next dev\`, \`astro dev\`, and \`sveltekit dev\`.
  - If the user explicitly asks you not to expose, preview, relay, register, or open the dev server in Happier, do not call \`happier_dev_preview_register\` unless they later ask you to.
  - If you already started a dev server without registering it and the user asks to view it in Happier, call \`happier_dev_preview_register\` for the running server.
  - Prefer the full loopback URL (including any base path) and, when obvious, the app name or framework.
  - Continue using browser or Playwright tools for your own verification; this preview registration is for the user-visible Happier panel.
`);

type ResolveEffectiveCodingPromptArgs = Readonly<{
  credentials: Credentials;
  settings: Record<string, unknown> | null | undefined;
  profileId: string | null | undefined;
  baseOverride?: string | null;
  executionRunsFeatureEnabled?: boolean;
  devPreviewFeatureEnabled?: boolean;
  memoryRecallGuidanceEnabled?: boolean;
  providerId?: string | null | undefined;
  disableTodos?: boolean;
  toolDelivery?: 'native_mcp' | 'shell_bridge' | 'unsupported';
  toolDeliverySessionId?: string | null;
  toolDeliveryDirectory?: string | null;
  memoryMachineId?: string | null;
  cache?: Map<string, string | null>;
  fetchPromptArtifactRecord?: FetchPromptArtifactRecord;
}>;

export async function resolveEffectiveCodingPromptText(
  args: ResolveEffectiveCodingPromptArgs,
): Promise<string> {
  const resolved = await resolveEffectiveCodingPromptPlan(args);
  return resolved.text;
}

export async function resolveEffectiveCodingPromptPlan(
  args: ResolveEffectiveCodingPromptArgs,
): Promise<Readonly<{
  plan: PromptPlanV1;
  text: string;
  diagnostics: ReturnType<typeof buildPromptPlanDiagnosticsV1>;
}>> {
  const settings = args.settings && typeof args.settings === 'object' && !Array.isArray(args.settings)
    ? args.settings
    : {};
  const cache = args.cache ?? new Map<string, string | null>();
  const memoryRecallGuidanceEnabled =
    typeof args.memoryRecallGuidanceEnabled === 'boolean'
      ? args.memoryRecallGuidanceEnabled
      : await resolveCliMemoryRecallGuidanceEnabled();
  const devPreviewFeatureEnabled =
    typeof args.devPreviewFeatureEnabled === 'boolean'
      ? args.devPreviewFeatureEnabled
      : resolveCliFeatureDecision({
        featureId: 'sessions.devPreview',
        env: process.env,
        accountSettings: settings as AccountSettings,
      }).state === 'enabled';
  const hasSupportedToolDelivery = (args.toolDelivery ?? 'native_mcp') !== 'unsupported';

  const basePlan = buildCodingSessionPromptPlanBaseV1({
    settings,
    base: args.baseOverride === null ? '' : args.baseOverride,
    executionRunsFeatureEnabled: args.executionRunsFeatureEnabled === true,
    memoryRecallGuidanceEnabled,
  });
  const stackBlocks = await resolveCliPromptStackSystemAppendBlocks({
    surface: 'coding',
    credentials: args.credentials,
    settings,
    profileId: args.profileId,
    cache,
    fetchPromptArtifactRecord: args.fetchPromptArtifactRecord,
  });

  const promptStackBlocks: PromptBlockV1[] = stackBlocks.map((text, index) => ({
    id: `prompt_stack.${index + 1}`,
    scope: 'user_prompt',
    text,
  }));
  const featureBlocks: PromptBlockV1[] = devPreviewFeatureEnabled && hasSupportedToolDelivery
    ? [{
      id: 'feature.dev_preview_register',
      scope: 'session',
      text: DEV_PREVIEW_PROMPT_GUIDANCE,
    }]
    : [];
  const providerBehaviorBlocks = resolveCodingProviderBehaviorBlocks({
    providerId: args.providerId,
    disableTodos: args.disableTodos,
  });
  const toolDeliveryBlocks = (() => {
    const toolDelivery = args.toolDelivery ?? 'native_mcp';
    const sessionId = typeof args.toolDeliverySessionId === 'string' ? args.toolDeliverySessionId.trim() : '';
    const directory = typeof args.toolDeliveryDirectory === 'string' ? args.toolDeliveryDirectory.trim() : '';
    if (toolDelivery !== 'shell_bridge' || !sessionId || !directory) return [] satisfies PromptBlockV1[];
    return resolveCodingToolDeliveryBlocks({
      delivery: toolDelivery,
      sessionId,
      directory,
      settings,
      memoryRecallGuidance: {
        enabled: memoryRecallGuidanceEnabled,
        machineId: args.memoryMachineId ?? null,
      },
    });
  })();
  const plan = buildPromptPlanV1({
    modality: 'coding',
    blocks: [...basePlan.blocks, ...promptStackBlocks, ...featureBlocks, ...providerBehaviorBlocks, ...toolDeliveryBlocks],
  });

  return {
    plan,
    text: renderPromptPlanV1(plan),
    diagnostics: buildPromptPlanDiagnosticsV1(plan),
  };
}
