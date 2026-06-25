# Host Preview Same-Site Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make host preview domain resolution same-site with the Happier web UI, derive safe defaults from the configured web URL, and fail fast on configurations that would break iframe `SameSite=Lax` cookie handoff.

**Architecture:** Add one server-owned resolver for host preview base-domain decisions. All feature payloads, token URL minting, startup validation, and host parsing use that resolver instead of independently reading `HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN` or request `Host` headers. Site comparison is centralized in a helper that uses Public Suffix List behavior for ordinary domains and exact rules for supported loopback wildcard domains.

**Tech Stack:** TypeScript, Fastify, Vitest, Zod, existing `apps/server` feature env system, `tldts` for Public Suffix List parsing unless an equivalent dependency already exists.

---

## Files

- Create: `apps/server/sources/app/devPreview/previewSite.ts`
  - Owns site computation, wildcardable-host checks, and same-site comparison.
- Create: `apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.ts`
  - Owns explicit/derived host preview base-domain resolution and fatal diagnostics.
- Create: `apps/server/sources/app/devPreview/hostPreviewStartupValidation.ts`
  - Owns startup fail-fast validation.
- Modify: `apps/server/sources/app/devPreview/previewHostNamespace.ts`
  - Stop directly reading `HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN`; consume the new resolver.
- Modify: `apps/server/sources/app/api/devPreview/sessionDevPreviewHttpRelay.ts`
  - Build host preview URLs from the resolved web UI origin, not arbitrary request origin.
- Modify: `apps/server/sources/app/features/catalog/readFeatureEnv.ts`
  - Use the resolver for host preview feature state and diagnostics.
- Modify: `apps/server/sources/app/features/sessionDevPreviewFeature.ts`
  - Expose resolved source/reason diagnostics if protocol schema supports them.
- Modify: `packages/protocol/src/features/payload/featureGatesSchema.ts`
  - Add optional host preview diagnostic fields if needed by server feature payload.
- Test: `apps/server/sources/app/devPreview/previewSite.test.ts`
- Test: `apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.test.ts`
- Test: `apps/server/sources/app/devPreview/previewHostNamespace.test.ts`
- Test: `apps/server/sources/app/api/routes/session/sessionDevPreviewRoutes.integration.spec.ts`
- Test: `apps/server/sources/app/features/catalog/resolveServerFeaturePayload.spec.ts`

## Task 1: Add Site Computation Helper

**Files:**
- Create: `apps/server/sources/app/devPreview/previewSite.ts`
- Test: `apps/server/sources/app/devPreview/previewSite.test.ts`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Write failing tests for supported and rejected sites**

Create `apps/server/sources/app/devPreview/previewSite.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  computePreviewSite,
  isHostWildcardableForPreview,
  isSamePreviewSite,
} from './previewSite';

describe('previewSite', () => {
  it('treats loopback wildcard domains as same-site', () => {
    expect(computePreviewSite('127.0.0.1.nip.io')).toBe('127.0.0.1.nip.io');
    expect(computePreviewSite('hp-abc.127.0.0.1.nip.io')).toBe('127.0.0.1.nip.io');
    expect(isSamePreviewSite('127.0.0.1.nip.io', 'hp-abc.127.0.0.1.nip.io')).toBe(true);

    expect(computePreviewSite('127.0.0.1.sslip.io')).toBe('127.0.0.1.sslip.io');
    expect(computePreviewSite('hp-abc.127.0.0.1.sslip.io')).toBe('127.0.0.1.sslip.io');
    expect(isSamePreviewSite('lvh.me', 'hp-abc.lvh.me')).toBe(true);
  });

  it('uses registrable domain behavior for ordinary domains', () => {
    expect(computePreviewSite('app.example.com')).toBe('example.com');
    expect(computePreviewSite('hp-abc.preview.example.com')).toBe('example.com');
    expect(isSamePreviewSite('app.example.com', 'hp-abc.preview.example.com')).toBe(true);
    expect(isSamePreviewSite('app.example.com', 'badexample.com')).toBe(false);
  });

  it('rejects hosts that cannot support wildcard preview derivation', () => {
    expect(isHostWildcardableForPreview('127.0.0.1')).toBe(false);
    expect(isHostWildcardableForPreview('localhost')).toBe(false);
    expect(isHostWildcardableForPreview('::1')).toBe(false);
    expect(isHostWildcardableForPreview('app.example.com')).toBe(true);
    expect(isHostWildcardableForPreview('127.0.0.1.nip.io')).toBe(true);
  });
});
```

- [ ] **Step 2: Add PSL dependency**

Modify `apps/server/package.json` dependencies:

```json
"tldts": "^6.1.86"
```

Then run:

```bash
yarn install
```

Expected: lockfile updates and `apps/server/package.json` has `tldts`.

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
yarn --cwd apps/server vitest run --isolate -c vitest.config.ts sources/app/devPreview/previewSite.test.ts
```

Expected: FAIL because `previewSite.ts` does not exist.

- [ ] **Step 4: Implement `previewSite.ts`**

Create `apps/server/sources/app/devPreview/previewSite.ts`:

```ts
import { getDomain } from 'tldts';

const LOOPBACK_WILDCARD_SITES = [
  '127.0.0.1.nip.io',
  '127.0.0.1.sslip.io',
  'lvh.me',
] as const;

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

function isIpHostname(hostname: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':');
}

export function computePreviewSite(hostname: string): string | null {
  const normalized = normalizeHostname(hostname);
  if (!normalized || normalized === 'localhost' || isIpHostname(normalized)) {
    return null;
  }

  for (const loopbackSite of LOOPBACK_WILDCARD_SITES) {
    if (normalized === loopbackSite || normalized.endsWith(`.${loopbackSite}`)) {
      return loopbackSite;
    }
  }

  return getDomain(normalized) ?? null;
}

export function isHostWildcardableForPreview(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized || normalized === 'localhost' || isIpHostname(normalized)) {
    return false;
  }
  return computePreviewSite(normalized) !== null;
}

export function isSamePreviewSite(leftHostname: string, rightHostname: string): boolean {
  const leftSite = computePreviewSite(leftHostname);
  const rightSite = computePreviewSite(rightHostname);
  return Boolean(leftSite && rightSite && leftSite === rightSite);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
yarn --cwd apps/server vitest run --isolate -c vitest.config.ts sources/app/devPreview/previewSite.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/package.json yarn.lock apps/server/sources/app/devPreview/previewSite.ts apps/server/sources/app/devPreview/previewSite.test.ts
git commit -m "feat(server): add preview site resolution helper"
```

## Task 2: Add Host Preview Base-Domain Resolver

**Files:**
- Create: `apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.ts`
- Test: `apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { resolveHostPreviewBaseDomain } from './hostPreviewBaseDomainResolution';

describe('resolveHostPreviewBaseDomain', () => {
  it('uses explicit same-site base domain', () => {
    expect(resolveHostPreviewBaseDomain({
      HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.example.com',
      HANDY_MASTER_SECRET: 'secret',
    })).toMatchObject({
      enabled: true,
      baseDomain: 'preview.example.com',
      source: 'explicit',
      webSite: 'example.com',
      previewSite: 'example.com',
    });
  });

  it('rejects explicit cross-site base domain', () => {
    expect(resolveHostPreviewBaseDomain({
      HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.other.test',
      HANDY_MASTER_SECRET: 'secret',
    })).toMatchObject({
      enabled: false,
      source: 'explicit',
      reason: 'cross_site_preview_base_domain',
      fatal: true,
    });
  });

  it('derives from explicit web URL when host is wildcardable', () => {
    expect(resolveHostPreviewBaseDomain({
      HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1.nip.io:3005',
      HANDY_MASTER_SECRET: 'secret',
    })).toMatchObject({
      enabled: true,
      baseDomain: '127.0.0.1.nip.io',
      source: 'derived',
      effectiveWebUrlSource: 'explicit',
    });
  });

  it('does not derive from default web URL fallback', () => {
    expect(resolveHostPreviewBaseDomain({
      HANDY_MASTER_SECRET: 'secret',
    })).toMatchObject({
      enabled: false,
      source: 'derived',
      reason: 'default_web_url_not_derivable',
      fatal: true,
    });
  });

  it('allows development path-only when derivation is unavailable', () => {
    expect(resolveHostPreviewBaseDomain({
      NODE_ENV: 'development',
      HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1:3005',
      HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
      HANDY_MASTER_SECRET: 'secret',
    })).toMatchObject({
      enabled: false,
      reason: 'path_mode_only',
      fatal: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
yarn --cwd apps/server vitest run --isolate -c vitest.config.ts sources/app/devPreview/hostPreviewBaseDomainResolution.test.ts
```

Expected: FAIL because `hostPreviewBaseDomainResolution.ts` does not exist.

- [ ] **Step 3: Implement resolver**

Create `apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.ts`:

```ts
import { parseBooleanEnv } from '@/config/env';
import {
  resolveEffectiveWebappUrl,
  resolveEffectiveWebappBaseUrl,
} from '@/app/serverUrls/effectiveServerUrls';
import { isHostWildcardableForPreview, isSamePreviewSite, computePreviewSite } from './previewSite';

export type HostPreviewBaseDomainSource = 'explicit' | 'derived';
export type EffectiveWebUrlSource = 'explicit' | 'derived_local_ui' | 'default';

export type HostPreviewBaseDomainResolution =
  | {
      enabled: true;
      baseDomain: string;
        source: HostPreviewBaseDomainSource;
        effectiveWebUrl: string;
        effectiveWebUrlSource: EffectiveWebUrlSource;
        webSite: string;
        previewSite: string;
    }
  | {
      enabled: false;
      source: 'none' | HostPreviewBaseDomainSource;
      effectiveWebUrl: string;
      effectiveWebUrlSource: EffectiveWebUrlSource;
      reason:
        | 'relay_disabled'
        | 'path_mode_only'
        | 'default_web_url_not_derivable'
        | 'invalid_web_url'
        | 'web_host_not_wildcardable'
        | 'invalid_preview_base_domain'
        | 'cross_site_preview_base_domain';
      fatal: boolean;
    };

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeBaseDomain(raw: string | undefined): string | null {
  const normalized = String(raw ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!normalized || normalized.length > 253 || /[:/\\\s]/.test(normalized)) return null;
  return normalized.split('.').every((label) => DNS_LABEL_PATTERN.test(label)) ? normalized : null;
}

function resolveWebUrl(env: NodeJS.ProcessEnv): { url: string; source: EffectiveWebUrlSource } {
  const explicitOrLocal = resolveEffectiveWebappUrl(env);
  if (explicitOrLocal) {
    return {
      url: explicitOrLocal,
      source: typeof env.HAPPIER_WEBAPP_URL === 'string' || typeof env.HAPPY_WEBAPP_URL === 'string' || typeof env.HAPPIER_PUBLIC_SERVER_URL === 'string'
        ? 'explicit'
        : 'derived_local_ui',
    };
  }
  return { url: resolveEffectiveWebappBaseUrl(env), source: 'default' };
}

function pathModeEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'development' && parseBooleanEnv(env.HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED, true);
}

function disabled(reason: HostPreviewBaseDomainResolution extends infer R ? R extends { enabled: false } ? R['reason'] : never : never, params: {
  source: 'none' | HostPreviewBaseDomainSource;
  effectiveWebUrl: string;
  effectiveWebUrlSource: EffectiveWebUrlSource;
  fatal: boolean;
}): HostPreviewBaseDomainResolution {
  return { enabled: false, reason, ...params };
}

export function resolveHostPreviewBaseDomain(env: NodeJS.ProcessEnv = process.env): HostPreviewBaseDomainResolution {
  if (!parseBooleanEnv(env.HAPPIER_FEATURE_SESSIONS_DEV_PREVIEW_RELAY__ENABLED, true)) {
    return disabled('relay_disabled', {
      source: 'none',
      effectiveWebUrl: resolveEffectiveWebappBaseUrl(env),
      effectiveWebUrlSource: 'default',
      fatal: false,
    });
  }

  const web = resolveWebUrl(env);
  let webUrl: URL;
  try {
    webUrl = new URL(web.url);
  } catch {
    return disabled('invalid_web_url', { source: 'derived', effectiveWebUrl: web.url, effectiveWebUrlSource: web.source, fatal: true });
  }

  const explicitBaseDomainRaw = String(env.HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN ?? '').trim();
  if (explicitBaseDomainRaw) {
    const baseDomain = normalizeBaseDomain(explicitBaseDomainRaw);
    if (!baseDomain) {
      return disabled('invalid_preview_base_domain', { source: 'explicit', effectiveWebUrl: web.url, effectiveWebUrlSource: web.source, fatal: true });
    }
    const previewSite = computePreviewSite(`hp-test.${baseDomain}`);
    const webSite = computePreviewSite(webUrl.hostname);
    if (!previewSite || !webSite || !isSamePreviewSite(webUrl.hostname, `hp-test.${baseDomain}`)) {
      return disabled('cross_site_preview_base_domain', { source: 'explicit', effectiveWebUrl: web.url, effectiveWebUrlSource: web.source, fatal: true });
    }
    return {
      enabled: true,
      baseDomain,
      source: 'explicit',
      effectiveWebUrl: web.url,
      effectiveWebUrlSource: web.source === 'default' ? 'explicit' : web.source,
      webSite,
      previewSite,
    };
  }

  if (web.source === 'default') {
    return disabled('default_web_url_not_derivable', {
      source: 'derived',
      effectiveWebUrl: web.url,
      effectiveWebUrlSource: web.source,
      fatal: !pathModeEnabled(env),
    });
  }

  if (!isHostWildcardableForPreview(webUrl.hostname)) {
    return disabled(pathModeEnabled(env) ? 'path_mode_only' : 'web_host_not_wildcardable', {
      source: 'derived',
      effectiveWebUrl: web.url,
      effectiveWebUrlSource: web.source,
      fatal: !pathModeEnabled(env),
    });
  }

  const webSite = computePreviewSite(webUrl.hostname);
  const previewSite = computePreviewSite(`hp-test.${webUrl.hostname}`);
  if (!webSite || !previewSite || webSite !== previewSite) {
    return disabled('cross_site_preview_base_domain', {
      source: 'derived',
      effectiveWebUrl: web.url,
      effectiveWebUrlSource: web.source,
      fatal: true,
    });
  }

  return {
    enabled: true,
    baseDomain: webUrl.hostname.toLowerCase(),
    source: 'derived',
    effectiveWebUrl: web.url,
    effectiveWebUrlSource: web.source,
    webSite,
    previewSite,
  };
}
```

- [ ] **Step 4: Run resolver tests**

Run:

```bash
yarn --cwd apps/server vitest run --isolate -c vitest.config.ts sources/app/devPreview/hostPreviewBaseDomainResolution.test.ts
```

Expected: PASS. If TypeScript rejects the conditional type in `disabled`, replace it with a named `HostPreviewDisabledReason` union copied from the resolution type.

- [ ] **Step 5: Commit**

```bash
git add apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.ts apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.test.ts
git commit -m "feat(server): resolve host preview base domain"
```

## Task 3: Use Resolver in Host Namespace and URL Minting

**Files:**
- Modify: `apps/server/sources/app/devPreview/previewHostNamespace.ts`
- Modify: `apps/server/sources/app/api/devPreview/sessionDevPreviewHttpRelay.ts`
- Test: `apps/server/sources/app/devPreview/previewHostNamespace.test.ts`
- Test: `apps/server/sources/app/api/routes/session/sessionDevPreviewRoutes.integration.spec.ts`

- [ ] **Step 1: Add host namespace tests for derived domain**

Modify `apps/server/sources/app/devPreview/previewHostNamespace.test.ts` with:

```ts
it('builds host namespace from derived same-site web URL', () => {
  const env = {
    HANDY_MASTER_SECRET: 'secret',
    HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1.nip.io:3005',
  };
  const host = buildHostNamespacePreviewHost(routeContext, env);
  expect(host).toMatch(/^hp-[a-z2-7]{26}\.127\.0\.0\.1\.nip\.io$/);
});

it('does not build host namespace from default web URL fallback', () => {
  const env = { HANDY_MASTER_SECRET: 'secret' };
  expect(buildHostNamespacePreviewHost(routeContext, env)).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
yarn --cwd apps/server vitest run --isolate -c vitest.config.ts sources/app/devPreview/previewHostNamespace.test.ts
```

Expected: FAIL because current implementation only reads `HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN`.

- [ ] **Step 3: Update `previewHostNamespace.ts`**

Replace direct base-domain reading with resolver consumption:

```ts
import { resolveHostPreviewBaseDomain } from './hostPreviewBaseDomainResolution';
```

Update base domain lookup sites:

```ts
function readBaseDomain(env: NodeJS.ProcessEnv): string | null {
  const resolution = resolveHostPreviewBaseDomain(env);
  return resolution.enabled ? resolution.baseDomain : null;
}
```

Keep existing `buildPreviewHostId`, `parseHostNamespacePreviewHost`, and host-id validation behavior unchanged.

- [ ] **Step 4: Add token URL origin integration test**

In `apps/server/sources/app/api/routes/session/sessionDevPreviewRoutes.integration.spec.ts`, add a test near the existing host preview token tests:

```ts
it('mints host preview URLs from the configured web origin', async () => {
  const fixture = await createFixture({
    env: {
      HANDY_MASTER_SECRET: 'secret',
      HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1.nip.io:3005',
    },
  });

  const mint = await fixture.inject({
    method: 'POST',
    url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
    headers: fixture.authHeaders,
  });

  expect(mint.statusCode).toBe(200);
  const body = mint.json() as { previewUrl: string; namespaceStrategy: string };
  const previewUrl = new URL(body.previewUrl);
  expect(body.namespaceStrategy).toBe('host');
  expect(previewUrl.protocol).toBe('http:');
  expect(previewUrl.port).toBe('3005');
  expect(previewUrl.hostname).toMatch(/^hp-[a-z2-7]{26}\.127\.0\.0\.1\.nip\.io$/);
});
```

If the fixture helper name differs, use the existing helper used by nearby token tests and preserve the same assertions.

- [ ] **Step 5: Update host preview URL construction**

In `apps/server/sources/app/api/devPreview/sessionDevPreviewHttpRelay.ts`, update `buildHostNamespacePreviewUrl` to use resolver effective web URL:

```ts
import { resolveHostPreviewBaseDomain } from '@/app/devPreview/hostPreviewBaseDomainResolution';
```

Replace the current request-origin based host URL construction:

```ts
const resolution = resolveHostPreviewBaseDomain(process.env);
if (!resolution.enabled) return null;
const previewHost = buildHostNamespacePreviewHost(params.routeContext, process.env);
if (!previewHost) return null;
const origin = new URL(resolution.effectiveWebUrl);
origin.hostname = previewHost;
origin.pathname = '/';
origin.search = '';
origin.hash = '';
origin.searchParams.set('previewToken', params.previewToken);
return origin.toString();
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
yarn --cwd apps/server vitest run --isolate -c vitest.config.ts sources/app/devPreview/previewHostNamespace.test.ts
yarn --cwd apps/server vitest run --isolate -c vitest.integration.config.ts sources/app/api/routes/session/sessionDevPreviewRoutes.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/sources/app/devPreview/previewHostNamespace.ts apps/server/sources/app/api/devPreview/sessionDevPreviewHttpRelay.ts apps/server/sources/app/devPreview/previewHostNamespace.test.ts apps/server/sources/app/api/routes/session/sessionDevPreviewRoutes.integration.spec.ts
git commit -m "feat(server): mint same-site host preview urls"
```

## Task 4: Wire Feature Payload and Startup Validation

**Files:**
- Create: `apps/server/sources/app/devPreview/hostPreviewStartupValidation.ts`
- Modify: `apps/server/sources/app/features/catalog/readFeatureEnv.ts`
- Modify: `apps/server/sources/app/features/sessionDevPreviewFeature.ts`
- Modify: `packages/protocol/src/features/payload/featureGatesSchema.ts`
- Test: `apps/server/sources/app/features/catalog/resolveServerFeaturePayload.spec.ts`

- [ ] **Step 1: Extend protocol schema test first**

Modify `apps/server/sources/app/features/catalog/resolveServerFeaturePayload.spec.ts` by adding:

```ts
it('exposes derived host preview base domain diagnostics', () => {
  const payload = resolveServerFeaturePayload({
    HANDY_MASTER_SECRET: 'secret',
    HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1.nip.io:3005',
  }, resolvers);

  expect(payload.features.sessions.devPreview.relay.host).toMatchObject({
    enabled: true,
    configured: false,
    baseDomain: '127.0.0.1.nip.io',
    source: 'derived',
  });
});

it('exposes fatal host preview diagnostics for cross-site explicit domains', () => {
  const payload = resolveServerFeaturePayload({
    HANDY_MASTER_SECRET: 'secret',
    HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
    HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.other.test',
  }, resolvers);

  expect(payload.features.sessions.devPreview.relay.host).toMatchObject({
    enabled: false,
    configured: true,
    baseDomain: null,
    source: 'explicit',
    reason: 'cross_site_preview_base_domain',
  });
});
```

Use the existing resolver array variable from the file; do not invent a second resolver registry.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
yarn --cwd apps/server vitest run --isolate -c vitest.config.ts sources/app/features/catalog/resolveServerFeaturePayload.spec.ts
```

Expected: FAIL because schema or feature payload does not expose `source` / reason behavior.

- [ ] **Step 3: Update protocol schema**

Modify `packages/protocol/src/features/payload/featureGatesSchema.ts` host schema to include optional fields:

```ts
const devPreviewRelayHostSchema = z.object({
  enabled: z.boolean().default(false),
  configured: z.boolean().default(false),
  baseDomain: z.string().nullable().default(null),
  suggestedBaseDomain: z.string().nullable().default(null),
  source: z.enum(['explicit', 'derived']).nullable().default(null),
  reason: z.string().optional(),
});
```

Keep defaults fail-closed and nullable so older servers/clients parse safely.

- [ ] **Step 4: Update feature env reading**

In `apps/server/sources/app/features/catalog/readFeatureEnv.ts`, replace host base-domain computation with:

```ts
const hostResolution = resolveHostPreviewBaseDomain(env);
const hostEnabled = hostResolution.enabled;
const hostBaseDomain = hostResolution.enabled ? hostResolution.baseDomain : null;
const pathEnabled = env.NODE_ENV === 'development'
  && parseBooleanEnv(env[FEATURE_ENV_KEYS.sessionsDevPreviewRelayPathModeEnabled], true);
const relayEnabled = featureToggleEnabled && (hostEnabled || pathEnabled);
```

Return additional fields by extending `SessionDevPreviewFeatureEnv`:

```ts
hostSource: hostResolution.enabled ? hostResolution.source : hostResolution.source === 'none' ? null : hostResolution.source,
disabledReason: hostResolution.enabled
  ? undefined
  : hostResolution.reason,
hostFatal: hostResolution.enabled ? false : hostResolution.fatal,
```

If TypeScript requires exact type updates, add `hostSource: 'explicit' | 'derived' | null` and `hostFatal: boolean` to `SessionDevPreviewFeatureEnv`.

- [ ] **Step 5: Update feature payload**

In `apps/server/sources/app/features/sessionDevPreviewFeature.ts`, include:

```ts
source: featureConfig.hostSource,
...(featureConfig.disabledReason ? { reason: featureConfig.disabledReason } : {}),
```

Keep `configured` as `Boolean(env.HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN?.trim())`, not as `source === 'explicit'`, so derived domains report `configured: false`.

- [ ] **Step 6: Add startup validation**

Create `apps/server/sources/app/devPreview/hostPreviewStartupValidation.ts`:

```ts
import { readSessionDevPreviewFeatureEnv } from '@/app/features/catalog/readFeatureEnv';

export function validateHostPreviewStartupConfig(env: NodeJS.ProcessEnv = process.env): void {
  const feature = readSessionDevPreviewFeatureEnv(env);
  if (!feature.featureToggleEnabled || !feature.hostFatal) {
    return;
  }
  throw new Error(`Invalid host preview configuration: ${feature.disabledReason ?? 'unknown'}`);
}
```

Wire this into the server startup path that validates feature configuration before listening. Search for the existing startup configuration validation owner and call `validateHostPreviewStartupConfig(process.env)` there. If no such owner exists, call it from the server app creation path before routes are registered.

- [ ] **Step 7: Run focused tests**

Run:

```bash
yarn --cwd apps/server vitest run --isolate -c vitest.config.ts sources/app/features/catalog/resolveServerFeaturePayload.spec.ts
yarn --cwd apps/server yarn -s build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/protocol/src/features/payload/featureGatesSchema.ts apps/server/sources/app/features/catalog/readFeatureEnv.ts apps/server/sources/app/features/sessionDevPreviewFeature.ts apps/server/sources/app/devPreview/hostPreviewStartupValidation.ts apps/server/sources/app/features/catalog/resolveServerFeaturePayload.spec.ts
git commit -m "feat(server): expose host preview domain diagnostics"
```

## Task 5: Add Startup State-Machine Coverage

**Files:**
- Test: `apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.test.ts`
- Test: `apps/server/sources/app/devPreview/hostPreviewStartupValidation.test.ts`

- [ ] **Step 1: Add resolver state-machine tests**

Append to `hostPreviewBaseDomainResolution.test.ts`:

```ts
it.each([
  ['relay disabled', {
    HAPPIER_FEATURE_SESSIONS_DEV_PREVIEW_RELAY__ENABLED: '0',
    HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.other.test',
  }, { enabled: false, reason: 'relay_disabled', fatal: false }],
  ['valid explicit', {
    HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
    HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.example.com',
  }, { enabled: true, source: 'explicit' }],
  ['invalid explicit', {
    HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
    HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'bad domain',
  }, { enabled: false, reason: 'invalid_preview_base_domain', fatal: true }],
  ['valid derived', {
    HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
  }, { enabled: true, source: 'derived', baseDomain: 'app.example.com' }],
  ['default fallback with dev path', {
    NODE_ENV: 'development',
    HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
  }, { enabled: false, reason: 'default_web_url_not_derivable', fatal: false }],
  ['default fallback without path', {
    NODE_ENV: 'production',
  }, { enabled: false, reason: 'default_web_url_not_derivable', fatal: true }],
])('%s', (_name, env, expected) => {
  expect(resolveHostPreviewBaseDomain({
    HANDY_MASTER_SECRET: 'secret',
    ...env,
  })).toMatchObject(expected);
});
```

- [ ] **Step 2: Add startup validation tests**

Create `apps/server/sources/app/devPreview/hostPreviewStartupValidation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { validateHostPreviewStartupConfig } from './hostPreviewStartupValidation';

describe('validateHostPreviewStartupConfig', () => {
  it('throws for explicit cross-site host preview configuration', () => {
    expect(() => validateHostPreviewStartupConfig({
      HANDY_MASTER_SECRET: 'secret',
      HAPPIER_PUBLIC_SERVER_URL: 'https://app.example.com',
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.other.test',
    })).toThrow(/cross_site_preview_base_domain/);
  });

  it('does not throw for development path-only mode', () => {
    expect(() => validateHostPreviewStartupConfig({
      NODE_ENV: 'development',
      HANDY_MASTER_SECRET: 'secret',
      HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1:3005',
      HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
    })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run state-machine tests**

Run:

```bash
yarn --cwd apps/server vitest run --isolate -c vitest.config.ts sources/app/devPreview/hostPreviewBaseDomainResolution.test.ts sources/app/devPreview/hostPreviewStartupValidation.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.test.ts apps/server/sources/app/devPreview/hostPreviewStartupValidation.test.ts
git commit -m "test(server): cover host preview startup states"
```

## Task 6: Update Docs and Run Final Validation

**Files:**
- Modify: `docs/plans/web-preview-ai-diagnostics-and-origin-limits.md`
- Optionally modify: existing server deployment docs that mention host preview env vars.

- [ ] **Step 1: Update docs with implementation status**

In `docs/plans/web-preview-ai-diagnostics-and-origin-limits.md`, update the Host Preview Follow-up section after implementation:

```md
Implementation note: host preview base-domain resolution is now centralized in
`apps/server/sources/app/devPreview/hostPreviewBaseDomainResolution.ts`.
Embedded host preview requires the generated preview host and the effective web
URL to compute to the same site. Invalid explicit host preview configuration
fails during startup.
```

- [ ] **Step 2: Run full server validation**

Run:

```bash
yarn --cwd apps/server test:unit
yarn --cwd apps/server test:integration
yarn --cwd apps/server typecheck
```

Expected: all commands exit 0. If integration tests require services not available locally, run the focused integration file from Task 3 and record the missing service as a handoff caveat.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the files listed in this plan are changed.

- [ ] **Step 4: Commit docs and any final fixes**

```bash
git add docs/plans/web-preview-ai-diagnostics-and-origin-limits.md
git commit -m "docs: document host preview same-site resolution"
```

## Self-Review

- Spec coverage: The plan covers same-site computation, explicit/derived resolution, default fallback behavior, request-origin removal from URL minting, startup fail-fast validation, feature diagnostics, tests, and docs.
- Placeholder scan: No implementation step relies on unspecified validation or generic "handle errors"; each task names files, code shape, commands, and expected outcomes.
- Type consistency: The resolver type is introduced once and consumed by namespace, feature env, and startup validation tasks. If the conditional type helper in Task 2 proves too clever for TypeScript, the task gives the exact fallback: replace it with a named union.
