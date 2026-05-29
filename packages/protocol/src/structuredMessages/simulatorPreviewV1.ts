import { z } from 'zod';

export const SimulatorPreviewPlatformSchema = z.enum(['android', 'ios']);
export type SimulatorPreviewPlatform = z.infer<typeof SimulatorPreviewPlatformSchema>;

export const SimulatorPreviewModeSchema = z.enum([
  'idle',
  'ai_control',
  'user_control',
  'system_locked',
  'ended',
]);
export type SimulatorPreviewMode = z.infer<typeof SimulatorPreviewModeSchema>;

export const SimulatorPreviewOwnerSchema = z.enum(['ai', 'user', 'system']);
export type SimulatorPreviewOwner = z.infer<typeof SimulatorPreviewOwnerSchema>;

export const SimulatorPreviewConnectionPathSchema = z.enum(['relay', 'direct', 'adb_reverse']);
export type SimulatorPreviewConnectionPath = z.infer<typeof SimulatorPreviewConnectionPathSchema>;

export const SimulatorPreviewStreamUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, { message: 'streamUrl must be an http(s) URL' });
export type SimulatorPreviewStreamUrl = z.infer<typeof SimulatorPreviewStreamUrlSchema>;

export const SimulatorPreviewRelaySchema = z.object({
  machineId: z.string().min(1),
  routeKey: z.string().min(1),
  streamPath: z.string().min(1).max(2000).refine((value) => value.startsWith('/') && !value.startsWith('//'), {
    message: 'streamPath must be an absolute preview path',
  }),
}).passthrough();
export type SimulatorPreviewRelay = z.infer<typeof SimulatorPreviewRelaySchema>;

export const SimulatorPreviewDevServiceStatusSchema = z.enum([
  'unknown',
  'starting',
  'connected',
  'healthy',
  'ready',
  'degraded',
  'error',
]);
export type SimulatorPreviewDevServiceStatus = z.infer<typeof SimulatorPreviewDevServiceStatusSchema>;

export const SimulatorPreviewDevServiceHealthSchema = z.object({
  status: SimulatorPreviewDevServiceStatusSchema,
  url: z.string().trim().min(1).max(2000).optional(),
  checkedAtMs: z.number().int().optional(),
}).passthrough();
export type SimulatorPreviewDevServiceHealth = z.infer<typeof SimulatorPreviewDevServiceHealthSchema>;

export const SimulatorPreviewDevServicesSchema = z.object({
  metro: SimulatorPreviewDevServiceHealthSchema.optional(),
  api: SimulatorPreviewDevServiceHealthSchema.optional(),
  hmr: SimulatorPreviewDevServiceHealthSchema.optional(),
}).passthrough();
export type SimulatorPreviewDevServices = z.infer<typeof SimulatorPreviewDevServicesSchema>;

export const SimulatorPreviewV1Schema = z.object({
  simulatorSessionId: z.string().min(1),
  sessionId: z.string().min(1),
  platform: SimulatorPreviewPlatformSchema,
  deviceName: z.string().min(1).max(200),
  appName: z.string().min(1).max(200).optional(),
  streamUrl: SimulatorPreviewStreamUrlSchema,
  mode: SimulatorPreviewModeSchema,
  owner: SimulatorPreviewOwnerSchema.optional(),
  connectionPath: SimulatorPreviewConnectionPathSchema,
  relay: SimulatorPreviewRelaySchema.optional(),
  nativeDevSessionId: z.string().trim().min(1).max(200).optional(),
  devServices: SimulatorPreviewDevServicesSchema.optional(),
  registeredAtMs: z.number().int(),
}).passthrough();
export type SimulatorPreviewV1 = z.infer<typeof SimulatorPreviewV1Schema>;

export function parseSimulatorPreviewV1(input: unknown): SimulatorPreviewV1 | null {
  const parsed = SimulatorPreviewV1Schema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
