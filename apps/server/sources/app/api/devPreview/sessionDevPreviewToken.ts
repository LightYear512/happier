import * as privacyKit from 'privacy-kit';

type TokenGeneratorLike = Awaited<ReturnType<typeof privacyKit.createEphemeralTokenGenerator>>;
type TokenVerifierLike = Awaited<ReturnType<typeof privacyKit.createEphemeralTokenVerifier>>;

type SessionDevPreviewTokenScope = Readonly<{
  userId: string;
  sessionId: string;
  machineId: string;
  routeKey: string;
}>;

type SessionDevPreviewTokenBackend = Readonly<{
  generator: TokenGeneratorLike;
  verifier: TokenVerifierLike;
}>;

let backendPromise: Promise<SessionDevPreviewTokenBackend> | null = null;
let backend: SessionDevPreviewTokenBackend | null = null;

function requireMasterSecret(env: NodeJS.ProcessEnv): string {
  const secret = (env.HANDY_MASTER_SECRET ?? '').trim();
  if (!secret) {
    throw new Error('HANDY_MASTER_SECRET is required');
  }
  return secret;
}

function readPreviewTokenTtlMs(env: NodeJS.ProcessEnv): number {
  const raw = (env.HAPPIER_SESSION_DEV_PREVIEW_TOKEN_TTL_SECONDS ?? '').trim();
  const parsed = Number.parseInt(raw, 10);
  const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
  return Math.min(Math.max(seconds, 30), 3600) * 1000;
}

export function resolveSessionDevPreviewTokenTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return Math.floor(readPreviewTokenTtlMs(env) / 1000);
}

async function getBackend(env: NodeJS.ProcessEnv): Promise<SessionDevPreviewTokenBackend> {
  if (backend) {
    return backend;
  }
  if (backendPromise) {
    return await backendPromise;
  }

  const masterSecret = requireMasterSecret(env);
  const ttl = readPreviewTokenTtlMs(env);
  backendPromise = (async () => {
    const generator = await privacyKit.createEphemeralTokenGenerator({
      service: 'happier-session-dev-preview',
      seed: masterSecret,
      ttl,
    });
    const verifier = await privacyKit.createEphemeralTokenVerifier({
      service: 'happier-session-dev-preview',
      publicKey: Uint8Array.from(generator.publicKey),
    });
    return { generator, verifier };
  })();

  try {
    const resolvedBackend = await backendPromise;
    backend = resolvedBackend;
    return resolvedBackend;
  } finally {
    backendPromise = null;
  }
}

export async function createSessionDevPreviewToken(
  scope: SessionDevPreviewTokenScope,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const tokenBackend = await getBackend(env);
  return await tokenBackend.generator.new({
    user: scope.userId,
    extras: {
      sessionId: scope.sessionId,
      machineId: scope.machineId,
      routeKey: scope.routeKey,
    },
  });
}

export async function verifySessionDevPreviewToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionDevPreviewTokenScope | null> {
  try {
    const tokenBackend = await getBackend(env);
    const verified = await tokenBackend.verifier.verify(token);
    if (!verified) {
      return null;
    }

    const userId = typeof verified.user === 'string' ? verified.user.trim() : '';
    const extras = verified.extras ?? {};
    const sessionId = typeof extras.sessionId === 'string' ? extras.sessionId.trim() : '';
    const machineId = typeof extras.machineId === 'string' ? extras.machineId.trim() : '';
    const routeKey = typeof extras.routeKey === 'string' ? extras.routeKey.trim() : '';
    if (!userId || !sessionId || !machineId || !routeKey) {
      return null;
    }

    return {
      userId,
      sessionId,
      machineId,
      routeKey,
    };
  } catch {
    return null;
  }
}
