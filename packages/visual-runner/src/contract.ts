import { z } from 'zod';

export const VisualErrorCodeSchema = z.enum([
  'policy_denied',
  'session_not_found',
  'browser_launch_failed',
  'browser_crashed',
  'navigation_timeout',
  'action_timeout',
  'target_not_found',
  'dev_server_unreachable',
  'artifact_write_failed',
  'artifact_expired',
]);
export type VisualErrorCode = z.infer<typeof VisualErrorCodeSchema>;

export const VisualArtifactKindSchema = z.enum(['screenshot', 'trace', 'console', 'network', 'a11y']);
export type VisualArtifactKind = z.infer<typeof VisualArtifactKindSchema>;

export const VisualArtifactRefSchema = z.object({
  id: z.string().min(1),
  kind: VisualArtifactKindSchema,
  mimeType: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  sizeBytes: z.number().int().nonnegative(),
});
export type VisualArtifactRef = z.infer<typeof VisualArtifactRefSchema>;

export const VisualPolicySchema = z.object({
  allowedOrigins: z.array(z.string().min(1)).default([]),
  allowExternalUrls: z.boolean().default(false),
});
export type VisualPolicy = z.input<typeof VisualPolicySchema>;
export type ResolvedVisualPolicy = z.output<typeof VisualPolicySchema>;

export const VisualSessionSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  createdAt: z.string().datetime(),
  status: z.enum(['starting', 'running', 'failed', 'closed']),
  policy: VisualPolicySchema,
});
export type VisualSession = z.infer<typeof VisualSessionSchema>;

export const VisualErrorSchema = z.object({
  code: VisualErrorCodeSchema,
  message: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  stepId: z.string().min(1).optional(),
  remediation: z.string().min(1).optional(),
});
export type VisualError = z.infer<typeof VisualErrorSchema>;

export const VisualStepSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  action: z.string().min(1),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  status: z.enum(['ok', 'error']),
  screenshotRef: VisualArtifactRefSchema.optional(),
  a11ySnapshotRef: VisualArtifactRefSchema.optional(),
  consoleRef: VisualArtifactRefSchema.optional(),
  networkRef: VisualArtifactRefSchema.optional(),
  traceRef: VisualArtifactRefSchema.optional(),
  error: VisualErrorSchema.optional(),
});
export type VisualStep = z.infer<typeof VisualStepSchema>;

export type VisualUrlPolicyResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; errorCode: 'policy_denied'; reason: 'invalid_url' | 'external_url_not_allowlisted' }>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function normalizeOrigin(rawOrigin: string): string | null {
  try {
    return new URL(rawOrigin).origin;
  } catch {
    return null;
  }
}

function isLoopbackUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

export function resolveVisualUrlPolicy(params: Readonly<{
  url: string;
  policy?: VisualPolicy;
}>): VisualUrlPolicyResult {
  let url: URL;
  try {
    url = new URL(params.url);
  } catch {
    return { ok: false, errorCode: 'policy_denied', reason: 'invalid_url' };
  }

  if (isLoopbackUrl(url)) return { ok: true };

  const policy = VisualPolicySchema.parse(params.policy ?? {});
  if (policy.allowExternalUrls) return { ok: true };

  const allowedOrigins = new Set(policy.allowedOrigins.map(normalizeOrigin).filter((origin): origin is string => origin !== null));
  if (allowedOrigins.has(url.origin)) return { ok: true };

  return { ok: false, errorCode: 'policy_denied', reason: 'external_url_not_allowlisted' };
}

const SENSITIVE_LINE_PATTERNS: readonly RegExp[] = [
  /^(\s*authorization\s*:\s*).+$/gim,
  /^(\s*cookie\s*:\s*).+$/gim,
  /(\b(?:access_token|refresh_token|id_token|api[_-]?key|token|secret|password)=)[^\s&]+/gim,
];

export function redactVisualTextArtifact(input: string): string {
  return SENSITIVE_LINE_PATTERNS.reduce(
    (value, pattern) => value.replace(pattern, (_match: string, prefix: string) => `${prefix}[REDACTED]`),
    input,
  );
}
