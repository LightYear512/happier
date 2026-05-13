import { z } from 'zod';

import { VisualPolicySchema } from '../contract.js';

export type VisualRunnerMcpToolName =
  | 'visual.resolve_url_policy'
  | 'visual.redact_text_artifact'
  | 'visual.create_session'
  | 'visual.navigate'
  | 'visual.type'
  | 'visual.click'
  | 'visual.inspect'
  | 'visual.get_console'
  | 'visual.get_network'
  | 'visual.screenshot'
  | 'visual.get_trace'
  | 'visual.get_dashboard'
  | 'visual.get_session'
  | 'visual.close_session';

export type VisualRunnerMcpToolDefinition = Readonly<{
  title: string;
  description: string;
  inputSchema: z.ZodType;
}>;

export const ResolveUrlPolicyInputSchema = z.object({
  url: z.string().min(1),
  policy: VisualPolicySchema.optional(),
});

export const RedactTextArtifactInputSchema = z.object({
  text: z.string(),
});

export const CreateSessionInputSchema = z.object({
  cwd: z.string().min(1).optional(),
  policy: VisualPolicySchema.optional(),
});

export const SessionIdInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const NavigateInputSchema = z.object({
  sessionId: z.string().min(1),
  url: z.string().min(1),
});

export const ScreenshotInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const TargetInputSchema = z.object({
  sessionId: z.string().min(1),
  target: z.string().min(1),
});

export const TypeInputSchema = z.object({
  sessionId: z.string().min(1),
  target: z.string().min(1),
  text: z.string(),
});

export const visualRunnerMcpToolDefinitions: ReadonlyArray<{
  name: VisualRunnerMcpToolName;
  definition: VisualRunnerMcpToolDefinition;
}> = [
  {
    name: 'visual.resolve_url_policy',
    definition: {
      title: 'Resolve Visual URL Policy',
      description: 'Check whether a URL is allowed by the Visual Runner local-first browsing policy.',
      inputSchema: ResolveUrlPolicyInputSchema,
    },
  },
  {
    name: 'visual.redact_text_artifact',
    definition: {
      title: 'Redact Visual Text Artifact',
      description: 'Redact common secrets from console, network, or text artifacts before surfacing them to users.',
      inputSchema: RedactTextArtifactInputSchema,
    },
  },
  {
    name: 'visual.create_session',
    definition: {
      title: 'Create Visual Session',
      description: 'Create a Visual Runner session record with policy metadata for later browser execution.',
      inputSchema: CreateSessionInputSchema,
    },
  },
  {
    name: 'visual.navigate',
    definition: {
      title: 'Navigate Visual Session',
      description: 'Navigate a Visual Runner browser session to an allowed URL.',
      inputSchema: NavigateInputSchema,
    },
  },
  {
    name: 'visual.screenshot',
    definition: {
      title: 'Capture Visual Screenshot',
      description: 'Capture the current browser page as a PNG screenshot artifact.',
      inputSchema: ScreenshotInputSchema,
    },
  },
  {
    name: 'visual.get_trace',
    definition: {
      title: 'Get Visual Trace',
      description: 'Capture the current Playwright trace as a ZIP artifact and restart tracing for later steps.',
      inputSchema: ScreenshotInputSchema,
    },
  },
  {
    name: 'visual.get_dashboard',
    definition: {
      title: 'Get Visual Dashboard',
      description: 'Return a localhost dashboard URL for browsing Visual Runner session artifacts.',
      inputSchema: ScreenshotInputSchema,
    },
  },
  {
    name: 'visual.type',
    definition: {
      title: 'Type In Visual Session',
      description: 'Fill a target input in the current Visual Runner browser page.',
      inputSchema: TypeInputSchema,
    },
  },
  {
    name: 'visual.click',
    definition: {
      title: 'Click Visual Target',
      description: 'Click a target in the current Visual Runner browser page.',
      inputSchema: TargetInputSchema,
    },
  },
  {
    name: 'visual.inspect',
    definition: {
      title: 'Inspect Visual Session',
      description: 'Return the current page URL, title, and visible body text.',
      inputSchema: ScreenshotInputSchema,
    },
  },
  {
    name: 'visual.get_console',
    definition: {
      title: 'Get Visual Console',
      description: 'Return console entries captured from the current Visual Runner browser page.',
      inputSchema: ScreenshotInputSchema,
    },
  },
  {
    name: 'visual.get_network',
    definition: {
      title: 'Get Visual Network',
      description: 'Return network response summaries captured from the current Visual Runner browser page.',
      inputSchema: ScreenshotInputSchema,
    },
  },
  {
    name: 'visual.get_session',
    definition: {
      title: 'Get Visual Session',
      description: 'Return the current Visual Runner session record for a session id.',
      inputSchema: SessionIdInputSchema,
    },
  },
  {
    name: 'visual.close_session',
    definition: {
      title: 'Close Visual Session',
      description: 'Close a Visual Runner session record and release runner-owned state.',
      inputSchema: SessionIdInputSchema,
    },
  },
];

export const visualRunnerMcpToolNames: readonly VisualRunnerMcpToolName[] = Object.freeze(
  visualRunnerMcpToolDefinitions.map((tool) => tool.name),
);
