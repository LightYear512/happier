import { z } from 'zod';

export const LocalServicePreviewFrameworkSchema = z.enum([
  'vite',
  'next',
  'webpack',
  'cra',
  'expo-web',
  'astro',
  'sveltekit',
  'other',
]);
export type LocalServicePreviewFramework = z.infer<typeof LocalServicePreviewFrameworkSchema>;

export const LocalServicePreviewSourceSchema = z.enum(['mcp_tool', 'manual']);
export type LocalServicePreviewSource = z.infer<typeof LocalServicePreviewSourceSchema>;

export const LocalServicePreviewHealthStatusSchema = z.enum(['unknown', 'checking', 'ready', 'dead']);
export type LocalServicePreviewHealthStatus = z.infer<typeof LocalServicePreviewHealthStatusSchema>;

export const LocalServicePreviewHealthSchema = z.object({
  status: LocalServicePreviewHealthStatusSchema,
  checkedAtMs: z.number().int().optional(),
}).passthrough();
export type LocalServicePreviewHealth = z.infer<typeof LocalServicePreviewHealthSchema>;

export const LocalServicePreviewV1Schema = z.object({
  resourceId: z.string().min(1),
  sessionId: z.string().min(1),
  machineId: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  origin: z.string().min(1).max(1000).optional(),
  url: z.string().min(1).max(2000).optional(),
  name: z.string().min(1).max(200).optional(),
  framework: LocalServicePreviewFrameworkSchema.optional(),
  source: LocalServicePreviewSourceSchema,
  registeredAtMs: z.number().int(),
  health: LocalServicePreviewHealthSchema,
  preview: z.object({
    rewriteUrls: z.boolean(),
    supportsWebSocket: z.boolean(),
    routeKey: z.string().min(1),
    initialPath: z.string().min(1).max(2000).optional(),
  }).passthrough(),
}).passthrough();
export type LocalServicePreviewV1 = z.infer<typeof LocalServicePreviewV1Schema>;

export function parseLocalServicePreviewV1(input: unknown): LocalServicePreviewV1 | null {
  const parsed = LocalServicePreviewV1Schema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
