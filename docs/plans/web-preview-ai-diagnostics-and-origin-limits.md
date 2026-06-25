# Web Preview AI Diagnostics And Origin Limits

> Status: proposed Happier sub-plan, 2026-06-24.
>
> Parent plans:
>
> - [web-preview-in-app.md](./web-preview-in-app.md)
> - [web-preview-url-rewriting.md](./web-preview-url-rewriting.md)

## Investigation Context

This plan was created from the preview-relay investigation in:

- Happier session: `cmqrsh7ps001bnz42aojje6f8`
- Codex session: `019ef8aa-5d13-7211-ae6c-b038d972c963`

Those sessions contain the original path-mode preview discussion, the
`allow-same-origin` vs `safeLocalStorage` analysis, and the HMR relay
diagnostics that motivated this plan.

## Purpose

Agents can see browser or build errors from a previewed app, but they often do
not know which Happier preview mode produced the page. That missing context can
lead them to chase the wrong fix. For example, a sandboxed path preview can make
`window.localStorage` throw a browser `SecurityError`, but an agent that only
sees the stack trace may interpret the failure as an application bug instead of
as a preview-origin limitation.

This plan records how Happier should expose preview-mode limitations to agents
and users so they can choose the right mitigation without weakening the preview
sandbox.

## Observed Problem

Path-mode relay serves preview content under the Happier relay origin, for
example:

```text
/preview/:sessionId/:machineId/:routeKey/*
```

Because that origin is shared with the relay application, the web iframe uses a
sandbox that intentionally omits `allow-same-origin`. This keeps the preview
document in an opaque origin. The security property is useful, but it means
browser APIs that require a normal same-origin document, such as
`localStorage`, `sessionStorage`, IndexedDB, and some cookie behavior, can be
unavailable.

A typical application stack trace then looks like:

```text
SecurityError: Failed to read the 'localStorage' property from 'Window':
The document is sandboxed and lacks the 'allow-same-origin' flag.
```

The correct diagnosis is not "Happier must always add `allow-same-origin` to
path mode." The correct diagnosis is:

- path mode is running in an opaque iframe sandbox
- origin-backed browser storage is unavailable in that mode
- the app can use an application-side safe storage fallback, or the preview can
  run in host mode when real origin semantics are required

## Terminology

- **path mode**: server-routed preview under the relay path prefix. This mode is
  convenient for development and tests, but it must remain sandboxed when it
  shares the Happier origin.
- **host mode**: server-routed preview on a resource-scoped host, such as
  `hp-<id>.<preview-base-domain>`. This mode can provide a real browser origin
  and is the right place to allow same-origin capabilities.
- **opaque sandbox**: iframe sandbox with scripts allowed but without
  `allow-same-origin`. The document gets an opaque origin and cannot use normal
  origin storage.
- **safe storage fallback**: application code that catches storage access
  failures and falls back to memory or a no-op storage implementation.

## Decision

Do not add `allow-same-origin` to path-mode previews by default.

Path mode and `allow-scripts allow-same-origin` together would give the
previewed app script-capable access to the relay origin. If that origin is also
used by Happier UI or other relay state, the preview can escape the intended
isolation boundary. This is a security regression, not just a compatibility
switch.

Instead, Happier should make the limitation explicit:

- agents should know when a preview is using path mode
- agents should know that path mode intentionally does not support
  `allow-same-origin`
- agents should know that storage errors in this mode are expected preview
  limitations
- agents should know the two valid remediation paths:
  application-side safe storage fallback, or host preview

## Safe Storage Fallback

`safeLocalStorage` is not a Happier feature and it is not equivalent to
`allow-same-origin`.

It is an application-side wrapper around storage access:

```ts
function getStorageItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
```

Real implementations usually provide a memory-backed replacement so the app can
continue running during the current page lifetime. This avoids crashing when the
browser denies `localStorage`, but it does not provide durable browser storage.
Refreshes can lose the fallback state.

Agents should recommend this pattern only when the app can tolerate degraded
persistence. If the app requires durable browser storage, cookies, IndexedDB,
OAuth redirects, service workers, or third-party SDK behavior tied to a real
origin, the agent should recommend host preview instead.

## Agent-visible Diagnostics

Expose a structured preview diagnostics block through the same surfaces agents
already use to inspect previews: list/status actions, preview registration
responses, and structured preview messages.

Suggested shape:

```ts
type WebPreviewRuntimeLimitation =
  | {
      code: 'opaque_path_sandbox';
      severity: 'info' | 'warning';
      message: string;
      effects: Array<
        | 'localStorage_unavailable'
        | 'sessionStorage_unavailable'
        | 'indexedDB_unavailable'
        | 'cookies_degraded'
      >;
      suggestedFixes: Array<'safe_storage_fallback' | 'host_preview'>;
    }
  | {
      code: 'runtime_rewriter_unavailable';
      severity: 'warning';
      reason: 'script-src-none' | 'script-src-strict-dynamic';
      suggestedFixes: Array<'host_preview' | 'adjust_csp_for_preview'>;
    }
  | {
      code: 'host_preview_cross_site';
      severity: 'warning';
      webOrigin: string;
      previewBaseDomain: string;
      suggestedFixes: Array<
        | 'use_same_site_web_url'
        | 'change_preview_base_domain'
        | 'path_preview_test_mode'
      >;
    }
  | {
      code: 'host_preview_proxy_bypass_required';
      severity: 'warning';
      previewBaseDomain: string;
      suggestedFixes: Array<
        | 'add_no_proxy_entry'
        | 'disable_proxy_for_preview_host'
      >;
    }
  | {
      code: 'host_preview_unconfigured';
      severity: 'info' | 'warning';
      requiredConfig: Array<
        | 'HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN'
        | 'HANDY_MASTER_SECRET'
        | 'wildcard_dns'
        | 'wildcard_tls'
      >;
    };
```

The first implementation does not need to model every browser API. It should
start with `opaque_path_sandbox`, because that is the limitation most likely to
produce misleading app errors.

## Agent Prompt Guidance

When Web Preview tools are available, the agent prompt should include a short
mode-specific instruction:

```text
If a Web Preview status reports `opaque_path_sandbox`, the path-mode iframe does
not include `allow-same-origin`. Browser storage APIs such as localStorage may
throw SecurityError. Do not ask to weaken path-mode sandbox by default. For
apps that can tolerate degraded persistence, add a safe storage fallback. For
apps that need real origin behavior, use or configure host preview.
```

This guidance belongs in the Web Preview feature prompt block, not in generic
provider prompts. It should appear only when the Web Preview feature is enabled
and the relevant tools or preview resources are exposed.

## UI Diagnostics

The preview pane should display the same limitation in user-facing form when a
path-mode preview is active:

- label the mode as a sandboxed path preview
- explain that storage APIs may be unavailable
- avoid suggesting `allow-same-origin` as a one-click fix
- if host preview is available, offer switching or reopening through host mode
- if host preview is unavailable, show the missing deployment configuration

The message should be concise. It should help users and agents understand the
runtime mode, not teach iframe security in full.

## Host Preview Configuration Guidance

For local development, prefer a loopback wildcard domain before public tunnels:

- `127.0.0.1.nip.io`
- `127.0.0.1.sslip.io`
- `lvh.me`

Host preview requires a base domain and stable host-id derivation:

```text
HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN=<loopback-or-real-preview-domain>
HANDY_MASTER_SECRET=<stable secret>
```

The host preview base domain may be explicit, but it must be same-site with the
effective Happier web URL. Host preview is rendered inside the Happier web UI,
and its token-to-cookie handoff relies on browser `SameSite=Lax` cookie rules.
If the web UI is loaded from `http://127.0.0.1:3005` and the preview iframe is
loaded from `http://hp-<id>.127.0.0.1.nip.io:3005`, Chrome treats the iframe as a
cross-site context and blocks the `happier_dev_preview_token` cookie with
`SameSiteLax`. The relay then redirects to a tokenless URL and receives
`invalid-preview-token`.

Therefore host preview configuration should be resolved as a server-side
invariant:

- If `HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN` is set, validate that it is
  same-site with `resolveEffectiveWebappBaseUrl(env)`.
- If it is not set, derive the host preview base domain from the effective web
  URL hostname when that hostname can support wildcard subdomains.
- If host preview is enabled but the explicit or derived base domain is invalid,
  fail fast at server startup instead of silently falling back to path mode.
- Keep development path mode available as an explicit test mode, but do not use
  path mode to hide a broken host preview configuration.

Examples:

```text
Web URL:     http://127.0.0.1.nip.io:3005
Preview URL: http://hp-<id>.127.0.0.1.nip.io:3005
Result:      same-site, valid for local host preview

Web URL:     http://127.0.0.1:3005
Preview URL: http://hp-<id>.127.0.0.1.nip.io:3005
Result:      cross-site, invalid for iframe cookie handoff

Web URL:     https://app.example.com
Preview URL: https://hp-<id>.app.example.com
Result:      same-site, valid when wildcard DNS/TLS route to Happier

Web URL:     https://app.example.com
Preview URL: https://hp-<id>.preview.other.test
Result:      cross-site, invalid for embedded host preview
```

The current implementation does not yet enforce this invariant. It only uses
`HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN` for host preview. When that env var
is missing, the server may expose a `suggestedHostBaseDomain` derived from
`HAPPIER_PUBLIC_SERVER_URL`, but it does not automatically enable host preview
from that suggestion.

### Host Preview Site Resolution

Use a single server-owned resolver for all host preview base-domain decisions:

```ts
type HostPreviewBaseDomainResolution =
  | {
      enabled: true;
      baseDomain: string;
      source: 'explicit' | 'derived';
      effectiveWebUrl: string;
      effectiveWebUrlSource: 'explicit' | 'derived_local_ui' | 'default';
      webSite: string;
      previewSite: string;
    }
  | {
      enabled: false;
      source: 'none' | 'explicit' | 'derived';
      effectiveWebUrl: string;
      effectiveWebUrlSource: 'explicit' | 'derived_local_ui' | 'default';
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
```

`readSessionDevPreviewFeatureEnv`, `buildHostNamespacePreviewHost`,
`buildHostNamespacePreviewUrl`, startup validation, and `/v1/features`
diagnostics should all consume this resolver. No caller should re-read or
re-validate `HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN` independently.

Site computation must be explicit:

- Resolve the web URL source explicitly. Derivation may use
  `resolveEffectiveWebappUrl(env)` when it returns an explicit web URL or a
  derived local UI URL. It must not derive host preview from the
  `DEFAULT_WEBAPP_URL` fallback returned by `resolveEffectiveWebappBaseUrl(env)`,
  because the server cannot infer that wildcard DNS/TLS exists for that default
  host.
- Explicit host preview base domains may still be validated against the
  effective web URL, including the default web URL, because an explicit preview
  base domain is an operator assertion that the wildcard deployment exists.
- Reject non-HTTP(S), usernames/passwords, IP hosts, `localhost`, and hosts that
  cannot support wildcard subdomains for host preview derivation.
- For ordinary domains, compute the site from the registrable domain using a
  Public Suffix List backed implementation, wrapped in a small Happier helper so
  the dependency and local-domain exceptions are centralized. Prefer `tldts` for
  this helper unless the implementation discovers an existing repository
  dependency that already exposes equivalent Public Suffix List behavior.
- For supported loopback wildcard domains, use exact suffix rules:
  - `127.0.0.1.nip.io` and `*.127.0.0.1.nip.io` share site
    `127.0.0.1.nip.io`
  - `127.0.0.1.sslip.io` and `*.127.0.0.1.sslip.io` share site
    `127.0.0.1.sslip.io`
  - `lvh.me` and `*.lvh.me` share site `lvh.me`
- Require matching schemes for embedded host preview. Local `http` is allowed
  only when both web and preview are `http`. Production deployments should use
  `https` for both web and preview.
- Treat a preview base domain as valid only when the preview host
  `hp-<id>.<baseDomain>` and the effective web URL produce the same computed
  site.
- Construct host preview URLs from the resolved web UI origin, not from an
  arbitrary request `Host` header. The iframe must be same-site with the page
  embedding it, so the URL minting path should replace the hostname of the
  effective web URL with `hp-<id>.<baseDomain>` while preserving the web URL's
  protocol and port. Request-origin based construction is acceptable only when
  the request origin is known to be the same web UI origin.

Do not use naive string suffix checks as the only production-domain rule.
`app.example.com` and `badexample.com` must never compare as same-site.

### Host Preview Startup State Machine

Host preview startup behavior should be deterministic:

| Relay feature | Explicit host base domain | Derived host base domain | Path mode | Startup behavior |
| --- | --- | --- | --- | --- |
| disabled | any | any | any | start; preview relay disabled |
| enabled | valid same-site | ignored | any | start with host preview enabled |
| enabled | invalid or cross-site | ignored | any | fail fast |
| enabled | unset | valid same-site derived domain | any | start with host preview enabled |
| enabled | unset | default web URL only | enabled development path mode | start path-only with `default_web_url_not_derivable` diagnostic |
| enabled | unset | default web URL only | disabled or production | fail fast |
| enabled | unset | unavailable | enabled development path mode | start path-only with `path_mode_only` diagnostic |
| enabled | unset | unavailable | disabled or production | fail fast |

This table intentionally distinguishes "path-only test mode" from "broken host
preview configuration." An explicit host base domain means the operator asked
for host preview; if it is invalid, path mode must not mask the configuration
error. When no host base domain is configured and only development path mode is
available, the server can start path-only because that is an explicit test
surface rather than a failed host preview deployment.

### Industry References

This design follows browser cookie and preview-hosting practice:

- [RFC6265bis section 8.8.3](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-14#section-8.8.3)
  notes that `Lax` and `Strict` SameSite cookies are inappropriate for content
  embedded in cross-site contexts and that such embedded content needs
  `SameSite=None` when cross-site cookies are required.
- [Chromium's SameSite rollout](https://blog.chromium.org/2019/10/developers-get-ready-for-new.html)
  requires `SameSite=None; Secure` for cross-site cookie access. That is not a
  good default for local HTTP host preview, so the product should instead keep
  embedded preview same-site.
- [MDN's third-party cookie guidance](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies)
  says cross-site iframe content cannot rely on `SameSite=Lax` cookies and must
  use `SameSite=None; Secure` if it remains cross-site.
- [GitHub Codespaces forwarded-port documentation](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)
  documents browser-accessible forwarded-port URLs, and
  [GitHub's forwarded-port domain update](https://github.blog/changelog/2023-07-14-codespaces-port-forwarding-domain-name-updates/)
  moved those URLs under `*.app.github.dev` for security, reliability, and
  performance. This is consistent with a dedicated preview-host namespace rather
  than path-only preview for browser apps.

For production or mobile-device QA, use a real wildcard domain and trusted TLS.
ngrok-style tunnels are useful only when they can provide the wildcard host
model required by resource-scoped preview hosts. A single random tunnel host is
not enough for host-mode isolation.

## Non-goals

- Do not make path mode unsandboxed by default.
- Do not silently add `allow-same-origin` based on app errors.
- Do not make Happier inject `safeLocalStorage` into arbitrary preview apps.
  Storage fallback is application code and must remain under app ownership.
- Do not parse arbitrary browser console output as the source of truth for the
  preview mode. The preview mode should come from structured Happier state.

## Implementation Direction

### Phase 1: Structured Limitation Metadata

- Extend the preview registry/status payload with `runtimeLimitations`.
- For path namespace previews rendered in sandboxed iframe mode, emit
  `opaque_path_sandbox`.
- Keep the limitation attached to the preview resource so list/status, transcript
  cards, and details panes use one source of truth.
- Add protocol tests for the limitation shape.

### Phase 2: Agent-facing Surfaces

- Include limitations in Web Preview list/status action results.
- Update the Web Preview feature prompt block with the path sandbox guidance.
- Add tests proving the prompt block mentions `opaque_path_sandbox` guidance only
  when Web Preview is enabled.
- Add tests proving list/status results expose the limitation without leaking
  preview tokens.

### Phase 3: UI-facing Surfaces

- Show a compact limitation state in the preview pane for path mode.
- Keep the iframe sandbox unchanged.
- If host preview is configured, show host preview as the recommended path for
  real origin behavior.
- If host preview is not configured, show the missing configuration in a
  copyable diagnostic section.

### Phase 4: Host Preview Follow-up

- Add or harden host preview local-development docs for `nip.io`, `sslip.io`,
  and `lvh.me`.
- Add deployment docs for wildcard DNS and wildcard TLS.
- Add a host preview base-domain resolver that returns the resolved base domain,
  source (`explicit` or `derived`), effective web URL, and validation
  diagnostics.
- Derive the default host preview base domain from the effective web URL when
  `HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN` is unset and the effective web
  URL was explicitly configured or derived from local UI configuration.
- Validate explicit host preview base domains against the effective web URL and
  fail fast when they are cross-site.
- Change host preview URL minting to use the resolved web UI origin instead of
  arbitrary request origin data.
- Implement the startup state machine from this document and cover every row in
  tests.
- Centralize site computation in one helper that wraps Public Suffix List domain
  parsing and the supported loopback wildcard exceptions.
- Keep `/v1/features` diagnostic fields for the resolved base domain and reason,
  but do not require clients or agents to repair an invalid server
  configuration.
- Document that local host preview should use a web URL such as
  `http://127.0.0.1.nip.io:<port>` rather than
  `http://127.0.0.1:<port>`.
- Add an integration check that proves host-mode preview returns
  `namespaceStrategy: 'host'` and the web iframe receives `allow-same-origin`
  only for host mode or same-machine direct mode.

## Test Plan

Behavior-changing implementation should be test-first.

Required tests:

- protocol/parser test for `runtimeLimitations`
- server token/status test showing path mode emits `opaque_path_sandbox`
- UI pane test showing path mode sandbox still omits `allow-same-origin`
- UI pane test showing host mode includes `allow-same-origin`
- server config test deriving host preview base domain from
  `http://127.0.0.1.nip.io:<port>`
- server config test deriving host preview base domain from
  `https://app.example.com`
- server config test proving the `DEFAULT_WEBAPP_URL` fallback does not
  implicitly enable derived host preview
- server config test rejecting derivation from `http://127.0.0.1:<port>`,
  `http://localhost:<port>`, and raw IP hosts
- server token URL test proving host preview URLs use the resolved web UI origin
  for scheme, port, and same-site host derivation
- server config test rejecting explicit host preview base domains that are
  cross-site with the effective web URL
- server config test accepting explicit same-site preview base domains, including
  `preview.example.com` for `app.example.com`
- server config test proving the Public Suffix List helper rejects confusing
  suffix cases such as `app.example.com` versus `badexample.com`
- server config tests for all host preview startup state-machine rows
- server startup test proving invalid host preview configuration fails fast
- MCP/action result test showing limitations are exposed to agents
- prompt test showing the agent receives safe-storage vs host-preview guidance
- regression test proving preview tokens are not included in diagnostics

Manual QA:

- Path-mode Vite app with direct `localStorage` access shows the limitation and
  can be fixed with app-side safe storage.
- Host-mode Vite app can use `localStorage` without the path-mode limitation.
- HMR still works in both modes.

## Open Questions

- Should path mode expose a stronger name such as `sandboxed_path` instead of
  overloading `namespaceStrategy: 'path'`?
- Should host preview be auto-preferred whenever configured, or should users be
  able to force path mode for debugging?
- Should the UI show storage limitations only after a preview error, or always
  when path-mode sandboxing is active?

## Exit Criteria

- Agents can inspect a preview and learn that path mode lacks
  `allow-same-origin`.
- Agents have explicit guidance to choose safe storage fallback or host preview.
- Path mode keeps its current sandbox security posture.
- Host mode is the documented path for full browser-origin semantics.
- Host preview configuration is validated before runtime, so embedded host
  preview cannot start in a browser state where `SameSite=Lax` token cookies are
  guaranteed to be blocked.
- The same-site resolver and startup state machine are covered by tests for
  explicit, derived, invalid, cross-site, and path-only development cases.
