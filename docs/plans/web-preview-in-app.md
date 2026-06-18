# Web Preview Inside Happier

> Status: revised Happier plan, 2026-06-06.
>
> This plan supersedes the experimental dev-preview and local-service-preview
> direction. The feature was test-only, so implementation should replace the old
> names and contracts in one vertical migration instead of adding aliases,
> compatibility shims, or parallel schemas.

## Decision Summary

- The product concept is **Web Preview**: a managed session resource for local
  web apps started or registered during an agent session.
- Web Preview should feel like simulator preview: it has lifecycle, status,
  focus, reload, and close controls, not just a transcript card that can only be
  opened.
- No backward compatibility is required for the experimental dev-preview names.
  Remove old action ids, MCP tool names, feature ids, structured-message kinds,
  UI resource kinds, prompts, tests, and docs in the same migration.
- The agent must be able to discover and reuse existing previews. Starting or
  registering the same server repeatedly must not create an unbounded pile of
  preview resources.
- Native clients must not pretend that a daemon-machine loopback URL is
  reachable. If no relay, same-machine path, or explicit device path is
  available, the pane shows an unavailable state with diagnostics.
- URL rewriting is a later hardening slice after lifecycle, registry, and relay
  behavior are green. The rewriting design lives in
  [web-preview-url-rewriting.md](./web-preview-url-rewriting.md).

## Problem

The current experimental preview experience is weaker than simulator preview:

- It can open previews, but it does not give the agent and user a complete
  lifecycle model for listing, reusing, focusing, reloading, or closing them.
- AI sessions can create duplicate preview resources because the contract is
  registration-only and does not make reuse the default.
- The native app can show an unavailable state forever when the only known URL is
  a loopback URL on the daemon machine.
- The old "dev preview" and "local service preview" naming makes the feature
  sound like an implementation detail rather than a first-class session surface.
- A raw transcript URL cannot express machine identity, process ownership,
  health, route keys, origin isolation, HMR support, or close semantics.

## Goals

- Provide a first-class Web Preview resource in the session details pane.
- Let agents start a dev server or register an already-running server through
  action-backed tools.
- Require `list`/`status` reuse paths so agents do not create duplicate previews.
- Provide user and tool controls for `focus`, `reload`, and `close`.
- Support web, native, and cross-device clients through explicit connection
  paths and honest unavailable states.
- Preserve modern dev-server behavior: streaming HTML, assets, SSE, and
  WebSocket/HMR.
- Keep preview access scoped to the authenticated Happier account, session,
  machine, and device where available.
- Make each behavior-changing slice test-first.

## Non-goals For v1

- Compatibility with `devPreview`, `localServicePreview`,
  `happier_dev_preview_register`, or `local_service_preview.v1`.
- Public sharing of Web Preview URLs.
- Regex-based discovery of arbitrary dev servers from logs.
- Browser automation. Visual Runner owns automation and evidence capture.
- Native Expo Dev Client preview. Expo-specific launch flows can be a later
  provider-owned enhancement.
- Rewriting JavaScript or JSON response bytes.

## Industry Baseline

The `plan-review` skill's `BENCHMARKS.md` is compiler-oriented and has no entry
for localhost tunneling, browser preview lifecycle, or streaming proxy systems.
This plan therefore carries the relevant benchmark registry locally. If Web
Preview becomes a broad platform primitive, move these entries into a repo-wide
benchmark file.

| System | Concrete module / mechanism | Happier design consequence |
| --- | --- | --- |
| GitHub Codespaces forwarded ports | Forwarded ports are listed, reused, opened, stopped, and exposed on separate browser origins. | Web Preview needs an indexed registry and lifecycle controls, not only transcript emission. |
| VS Code Dev Tunnels | `microsoft/dev-tunnels` stream-forwarding components preserve WebSocket upgrades. | The relay phase must be stream-multiplexed and WebSocket-native, not a request/response RPC wrapper. |
| ngrok / frp / wstunnel | yamux/smux or HTTP/2-like multiplexed tunnels. | One logical stream per HTTP request or WebSocket session; no head-of-line blocking through one serialized RPC. |
| Cloudflare Tunnel | HTTP/2 or QUIC stream forwarding keeps body bytes binary. | Happier must not base64 HTTP or WebSocket bodies on the hot path. |
| Cloudflare Workers `HTMLRewriter` / `lol-html` | Token-level streaming HTML transformation. | URL rewriting must preserve early chunk delivery and cannot buffer a full SSR document. |
| StackBlitz WebContainer | Service Worker network interception for in-browser servers. | Service Worker mode is a strict-CSP fallback, not the primary mode, because fetch interception does not fully cover WebSocket/EventSource. |

## Existing Happier Anchors

Use these instead of adding side systems:

- Feature catalog: `packages/protocol/src/features/catalog.ts`
- CLI feature decisions: `apps/cli/src/features/featureDecisionService.ts`
- UI feature decisions: `apps/ui/sources/sync/domains/features/featureDecisionRuntime.ts`
- Built-in session MCP server: `apps/cli/src/mcp/createHappierMcpServer.ts`
- Built-in tool catalog and dispatch: `apps/cli/src/agent/tools/happierTools/*`
- Structured message envelope: `packages/protocol/src/structuredMessages/HappierMetaEnvelope.ts`
- UI structured message registry: `apps/ui/sources/components/sessions/transcript/structured/structuredMessageRegistry.tsx`
- Details pane: `apps/ui/sources/components/sessions/panes/SessionDetailsPanel.tsx`
- Machine transfer and socket routing references: `packages/protocol/src/socketRpc.ts`, `apps/server/sources/app/api/socket/machineTransferHandler.ts`, `apps/cli/src/machines/transfer/*`

## Naming Migration

Implementation must replace the experimental names rather than support both.

| Old experimental name | New canonical name |
| --- | --- |
| `sessions.devPreview` | `sessions.webPreview` |
| `sessions.devPreview.relay` | `sessions.webPreview.relay` |
| `local_service_preview.v1` | `web_preview.v1` |
| `LocalServicePreviewV1` | `WebPreviewV1` |
| `session.devPreview.*` | `session.webPreview.*` |
| `happier_dev_preview_*` | `happier_web_preview_*` |
| `apps/cli/src/session/devPreview/` | `apps/cli/src/session/webPreview/` |
| `packages/protocol/src/sessionDevPreview/` | `packages/protocol/src/sessionWebPreview/` |
| `apps/server/sources/app/devPreview/` | `apps/server/sources/app/webPreview/` |
| `resource.kind === "localServicePreview"` | `resource.kind === "webPreview"` |

There should be no deprecated aliases, dual structured-message readers, hidden
compat flags, migration adapters, or duplicate UI renderers. Tests should assert
that the old public tool names and old structured-message kind are absent after
the migration.

## Feature Gates

Add feature ids through the canonical catalog:

- `sessions.webPreview`
  - representation: `client`
  - dependency: `sessions`
  - owns UI affordances, CLI local policy, prompt suffix, and MCP tool
    availability.
  - settings: experimental UI toggle, `showInSettings: true`,
    `defaultEnabled: false`.
- `sessions.webPreview.relay`
  - representation: `server`
  - dependency: `sessions.webPreview`
  - owns server preview-token routes and server-routed preview streams.
  - server default: allow unless build policy or server config denies it, so the
    UI can still show the client opt-in toggle.

Use feature decisions everywhere. Do not gate on raw env vars, raw
`/v1/features` payload poking, or capability fields.

Because server dependency enforcement reads enabled-bit paths from the
`/v1/features` payload, the server resolver for `sessions.webPreview.relay`
must also populate the parent support bit at
`features.sessions.webPreview.enabled`. That bit means "server supports the
parent feature"; it is not the user's local opt-in. UI and CLI decisions must
still combine it with local/account-settings policy before exposing UI, prompts,
or tools.

## Protocol Contract

Add a structured message payload in
`packages/protocol/src/structuredMessages/webPreviewV1.ts`.

Envelope:

```ts
{
  kind: "web_preview.v1",
  payload: WebPreviewV1
}
```

Draft payload shape:

```ts
type WebPreviewLifecycle =
  | "starting"
  | "ready"
  | "reloading"
  | "dead"
  | "closed";

type WebPreviewConnectionPath =
  | "relay"
  | "same_machine"
  | "adb_reverse"
  | "unavailable";

type WebPreviewV1 = {
  resourceId: string;
  sessionId: string;
  machineId: string;
  projectPath?: string;
  cwd?: string;
  command?: string;
  port: number;
  origin: string;
  initialPath?: string;
  name?: string;
  framework?: "vite" | "next" | "webpack" | "cra" | "expo-web" | "astro" | "sveltekit" | "other";
  ownership: "agent" | "user" | "system";
  lifecycle: WebPreviewLifecycle;
  connectionPath: WebPreviewConnectionPath;
  health: {
    status: "unknown" | "checking" | "ready" | "dead";
    checkedAtMs?: number;
    errorCode?: "connect_failed" | "timeout" | "feature_disabled" | "route_missing" | "unsupported_client";
    message?: string;
  };
  relay?: {
    machineId: string;
    routeKey: string;
    namespaceStrategy: "host" | "path" | "sandboxed_path";
  };
  controls: {
    focus: boolean;
    reload: boolean;
    close: boolean;
    restart: boolean;
  };
  registeredAtMs: number;
  updatedAtMs: number;
  closedAtMs?: number;
};
```

Rules:

- No signed preview token in transcript metadata.
- No raw relay URL in the durable transcript contract.
- `resourceId` is a stable registry identity for the preview resource; it is
  used for lookup and must not be decoded into a port.
- `routeKey` is an opaque route handle. Server and daemon code must look it up in
  a registry instead of deriving port access from a URL.
- Forked sessions do not inherit active Web Preview resources.
- A closed preview remains representable in transcript history but is not listed
  as active and cannot be reopened without `start` or `register`.

## Tool Contract

Expose Web Preview through ActionSpec-backed Happier tools, not manual MCP-only
tools:

- `session.webPreview.start` / `happier_web_preview_start`
- `session.webPreview.register` / `happier_web_preview_register`
- `session.webPreview.list` / `happier_web_preview_list`
- `session.webPreview.status` / `happier_web_preview_status`
- `session.webPreview.focus` / `happier_web_preview_focus`
- `session.webPreview.reload` / `happier_web_preview_reload`
- `session.webPreview.close` / `happier_web_preview_close`

ActionSpecs own tool names, input schemas, action enablement, approval policy,
surface availability, and required features. Set
`requiredFeatureId: "sessions.webPreview"` for every Web Preview action, and
also require `sessions.webPreview.relay` for relay-only operations.

Availability must flow through one composite helper, for example
`isActionSpecAvailableForSurface(spec, ctx)`, covering:

- `startHappyServer.ts` tool-name snapshots
- `registerHappierMcpResources.ts` action-spec resources
- `createActionToolExecutorBridge.ts` and direct action tool dispatch
- `action_spec_search`, `action_spec_get`, and `action_options_resolve`
- `action_execute` and direct action-id execution

### `start`

Starts and manages a dev server process when the agent can supply a command and
working directory.

Input:

```ts
{
  cwd: string;
  command: string;
  port?: number;
  initialPath?: string;
  name?: string;
  framework?: string;
  healthPath?: string;
  replace?: boolean;
}
```

Behavior:

- Calls `list`/registry lookup first and returns an existing active preview for
  the same `(sessionId, machineId, cwd, port?)` unless `replace` is true.
- If `port` is omitted, the command must declare a bounded readiness contract
  that yields exactly one loopback port, such as an explicit framework adapter
  that starts the process with a chosen ephemeral port and verifies that same
  port. Do not infer ports by scraping arbitrary stdout, regexing logs, or
  scanning the machine.
- If readiness produces zero ports or multiple candidate ports, `start` returns a
  structured error and leaves no active preview resource behind.
- Starts the process through the repo's managed runtime/process abstractions;
  product runtime paths must stay binary-safe and must not directly spawn
  package managers unless the owning runtime abstraction classifies that path as
  allowed.
- Tracks process ownership so `close` can stop only processes started by Web
  Preview.
- Emits a `web_preview.v1` message when lifecycle changes to `starting` and
  again when it becomes `ready`, `dead`, or `closed`.

### `register`

Registers an already-running loopback dev server.

Input:

```ts
{
  port: number;
  initialPath?: string;
  name?: string;
  framework?: string;
  healthPath?: string;
  rewriteUrls?: boolean;
  replace?: boolean;
}
```

Behavior:

- Idempotent for `(sessionId, machineId, cwd/projectPath, port)`.
- Rejects non-loopback hosts; the tool accepts ports only, not arbitrary URLs.
- `healthPath` is path-only, must start with `/`, and must not contain a scheme
  or host.
- Updates the per-session registry and emits `web_preview.v1`.
- Returns an existing active preview unless `replace` is true.

### `list` and `status`

These are required for AI reuse and UI consistency.

- `list` returns active previews for the current session, with optional filters
  for `cwd`, `port`, `framework`, and lifecycle.
- `status` returns one preview by `resourceId` or by `(cwd, port)`.
- Both tools must be side-effect free except for bounded health refreshes.
- Both tools include `lifecycle`, `connectionPath`, `controls`, and stable error
  codes so the agent can choose reuse, reload, close, or unavailable messaging
  without guessing from prose.
- The session-agent prompt must instruct agents to call `list` or `status`
  before starting or registering a preview after commands such as `npm run dev`,
  `yarn dev`, `pnpm dev`, `bun dev`, `vite`, `next dev`, `astro dev`, and
  `sveltekit dev`.

### `focus`, `reload`, and `close`

- `focus` opens or foregrounds the resource's details-pane tab.
- `reload` asks the active pane to reload and refreshes health.
- `close` marks the resource closed, closes the details-pane tab, unregisters
  route keys, stops a managed process if Web Preview started it, and emits a
  closed `web_preview.v1` state.
- Closing a registered user-owned process must not kill the user's external dev
  server; it only removes Happier's preview resource.

## CLI Runtime Registry

Create an owning CLI domain under:

```text
apps/cli/src/session/webPreview/
```

Initial modules:

- `createSessionWebPreviewRegistry.ts`
- `normalizeWebPreviewRegistration.ts`
- `createSessionWebPreviewHealthChecker.ts`
- `createSessionWebPreviewProcessManager.ts`
- `emitWebPreviewMessage.ts`

Registry behavior:

- In-memory and session-scoped for v1.
- Keyed by `(sessionId, machineId, cwd/projectPath, port)`.
- Stores `resourceId -> port` and `routeKey -> resourceId`; preview streams may
  resolve ports only through these maps.
- Stores `processId/resourceId` ownership for managed starts.
- Health checker attempts a bounded TCP or HTTP check to `127.0.0.1:<port>`.
- Mark dead after a configurable grace period, defaulting to 30 seconds.
- Do not unregister on the first failed check; dev servers often restart.
- `close` unregisters route keys immediately and stops only owned processes.

## UI Contract

The transcript card is an entry point, not the live preview container.

Implementation surface:

- Add `web_preview.v1` to `StructuredMessageKind`.
- Add `WebPreviewMessageCard`.
- The card opens a details tab with `resource.kind === "webPreview"`.
- Add `SessionWebPreviewPane` as the built-in details-pane renderer for
  `webPreview`.
- The pane owns loading, unavailable, dead-port, reloading, and closed states.
- The pane exposes icon controls for focus, reload, close, and open-external when
  the connection path allows it.

Preview component shape:

```ts
type SessionWebPreviewPaneProps = {
  resourceId: string;
  sessionId: string;
  scopeId: string;
  machineId: string;
  connectionPath: WebPreviewConnectionPath;
  routeKey?: string;
  initialPath?: string;
  name?: string;
};
```

Web should use an `iframe`. Native should use the existing app WebView pattern if
available. Native must not load the daemon machine's loopback URL. If no valid
relay or device-specific connection path is available, native shows
`connectionPath: "unavailable"` with the health error code.

## Transport And Relay Contract

The relay slice must be built as a session/machine stream, not as file transfer
and not as request/response RPC.

Preferred shape:

- Add a Web Preview stream protocol under
  `packages/protocol/src/sessionWebPreview/`.
- Add a socket event similar in spirit to `MACHINE_TRANSFER_ENVELOPE`, but with
  preview-specific envelopes and binary body chunks.
- Use Socket.IO binary payloads for response/request body bytes. Do not base64
  body chunks.
- Route by `(accountId, sessionId, sourceMachineId, streamId)`.
- Keep machine-scoped authorization checks aligned with existing
  machine-transfer handling.

Envelope families:

- `open_http`
- `open_ws`
- `response_head`
- `data`
- `end`
- `reset`
- `ws_accept`
- `ws_close`
- `window_update`

Server route:

```text
ANY /web-preview/:sessionId/:machineId/:routeKey/*
```

Token route:

```text
POST /v1/sessions/:sessionId/web-preview-token
GET  <previewOrigin>/web-preview-token-redirect
```

Token request shape:

```ts
type WebPreviewTokenRequest = {
  machineId: string;
  routeKey: string;
  returnPath?: string;
};
```

The `POST` response returns a preview-origin redirect URL for
`GET <previewOrigin>/web-preview-token-redirect` with a one-time exchange code,
not a reusable bearer token. The redirect handler runs on the resolved
resource-scoped preview origin, consumes the code, sets a host-scoped preview
cookie for that origin, and redirects to the resource path. The main Happier app
origin must not set cookies for preview origins.

Connection paths:

- `relay`: preferred web and native path through the server/daemon stream.
- `same_machine`: local web development fallback only when browser, server, and
  daemon are the same machine and protocol constraints allow iframe loading.
- `adb_reverse`: optional Android-device development path when the daemon has
  explicitly established and verified an ADB reverse mapping for that preview.
- `unavailable`: honest state with a stable `health.errorCode`.

Origin isolation requirements:

- Production web/native relay URLs resolve through a configured preview-origin
  template, for example `HAPPIER_PUBLIC_WEB_PREVIEW_ORIGIN_TEMPLATE`.
- Preferred production mode is resource-scoped origin isolation, such as
  `https://<routeKey>.<previewBaseHost>`, so cookies, localStorage, IndexedDB,
  and service workers are not shared across preview resources or with the main
  Happier app.
- The path shape remains
  `/web-preview/:sessionId/:machineId/:routeKey/*`, but script-capable HTML must
  not be served under the main app origin. The main origin may redirect to the
  preview origin or return an unavailable response.
- A shared preview origin or same-origin path mode is allowed only as a
  restricted fallback with an iframe sandbox that omits `allow-same-origin` and
  prevents origin-wide storage sharing. If that breaks a framework's
  fetch/XHR/HMR behavior, the pane must show the limitation instead of silently
  weakening the sandbox.
- `routeKey` is an opaque routing handle, not an auth secret.

Transport requirements:

- One stream per HTTP request or WebSocket session.
- Preserve HTTP method, path, query, allowed headers, status, and response
  headers.
- Preserve WebSocket text vs binary frames and close codes.
- Support SSE by streaming chunks without buffering the full response.
- Enforce per-stream byte/window limits to prevent unbounded buffering.
- Preview token scope includes `(accountId, sessionId, machineId, routeKey,
  deviceId where available)`.
- Token material is not left in durable URLs, and preview responses use
  `Referrer-Policy: no-referrer`.
- The relay strips Happier app credentials before forwarding upstream.
- Upstream `Set-Cookie` is accepted only when it is isolated by a
  resource-scoped preview origin or rewritten into the route's cookie namespace;
  otherwise the relay drops it and reports a preview limitation.
- The server route validates account/session/machine/token scope, then opens a
  stream by `routeKey`; it must not accept a raw port from the URL.
- The daemon is the authoritative port gate: it resolves
  `routeKey -> resourceId -> port` from its session registry and rejects missing,
  dead, closed, or feature-disabled entries before connecting to loopback.

## Performance Budgets

All values are initial configurable budgets and must be enforced by tests or
diagnostics before a phase exits.

| Budget | Target |
| --- | --- |
| Start/register-to-card update | p95 under 1 s on a healthy local session socket |
| List/status lookup | p95 under 100 ms for 100 active previews |
| Close propagation | p95 under 1 s from tool call to UI closed state |
| HTTP HTML relay overhead | p50 under 200 ms and p99 under 750 ms over a 50 ms RTT relay |
| Static asset relay overhead | p50 under 150 ms and p99 under 500 ms over a 50 ms RTT relay |
| WebSocket/HMR roundtrip | p50 under 300 ms and p99 under 1 s over a 50 ms RTT relay |
| First transformed HTML chunk | emitted within 10 ms of the upstream chunk in the streaming rewriter benchmark |
| Per-frame body payload | bounded and configurable; initial cap no larger than 16 MiB |
| Per-stream in-flight data | bounded and configurable; initial cap no larger than 32 MiB |

If a target cannot be met in implementation, the phase must either tighten the
design or explicitly move the feature behind a narrower experimental gate with
documented limits.

## URL Rewriting

Do not implement URL rewriting before lifecycle, registry, and relay behavior are
green.

When implemented, follow
[web-preview-url-rewriting.md](./web-preview-url-rewriting.md):

- Streaming HTML rewriting only.
- HTML/CSS rewriting for loopback absolute URLs and root-relative same-dev-server
  URLs.
- CSS `url(...)` and `@import` rewriting only for URL tokens, not arbitrary CSS
  text mutation.
- CSP nonce coordination.
- Runtime interceptor for `fetch`, `XMLHttpRequest`, `WebSocket`, and
  `EventSource`.
- Service Worker fallback only for incompatible CSP.
- No JavaScript or JSON body rewriting.

## Security

- Dev servers remain loopback-only on the session machine.
- Registration accepts a port, not an arbitrary host.
- Preview tokens are short-lived and bound to session, machine, account, and
  device where available.
- Tokens are never written into transcript metadata or structured messages.
- Web iframe/WebView storage is isolated through a resource-scoped preview origin
  when available, or through a sandboxed degraded mode that does not grant
  same-origin access to the main Happier app or other preview resources.
- Server routes deny access when the feature gate is disabled, the session is
  inaccessible, the machine is not owned by the account, or the route is not
  registered and active.
- Strip or block hop-by-hop headers at the relay boundary.

## Implementation Phases

### Phase 1: Contract Rename And Lifecycle Tools

- Rename old experimental feature ids, structured-message kinds, action ids,
  MCP tool names, UI resource kinds, test fixtures, prompt text, and docs to Web
  Preview.
- Add the `web_preview.v1` protocol schema.
- Add UI registry/local-policy entries for `sessions.webPreview` with
  experimental `defaultEnabled: false`, plus CLI local-policy support for
  account-settings feature toggles.
- Add `/v1/features` gate schema and server resolver support bits for
  `features.sessions.webPreview.enabled` and
  `features.sessions.webPreview.relay.enabled`.
- Add the Web Preview ActionSpecs for `start`, `register`, `list`, `status`,
  `focus`, `reload`, and `close`.
- Add required-feature filtering for ActionSpec-backed tools and verify disabled
  `sessions.webPreview` hides every Web Preview tool.
- Add absence tests for the old experimental tool names and structured-message
  kind.

Exit: the public contract is Web Preview only. Old experimental names are absent
from action discovery, MCP tool listing, protocol structured-message kinds, UI
resource kinds, prompts, and docs.

### Phase 2: Registry, Start/Register, And Close

- Add CLI registry, health checker, process manager, and lifecycle emitter.
- Implement `list`, `status`, `start`, `register`, and `close`.
- Make `start` and `register` reuse an existing active preview by default.
- Ensure `close` stops only Web Preview-owned processes and unregisters route
  keys for both owned and registered previews.
- Add the UI transcript card and details-tab shell with unavailable and closed
  states.

Exit: an agent can start or register a preview, reuse it, focus it, reload
health, close it, and stop creating duplicates.

### Phase 3: Same-machine And Device-specific Development Paths

- For local-development web/desktop clients running on the daemon machine over a
  compatible loopback origin, allow the details tab to load a same-machine iframe
  URL behind the feature gate.
- Keep production web and native clients in relay or unavailable mode; do not
  claim daemon loopback works cross-device.
- Add optional `adb_reverse` support only when the daemon explicitly creates and
  verifies a mapping for the connected Android device.

Exit: local web can render Vite/Next through the Web Preview tab, and native
states are honest instead of silently pointing at unreachable loopback URLs.

### Phase 4: Server-routed HTTP And WebSocket Relay

- Add preview token routes.
- Add server Web Preview route.
- Add daemon-side HTTP and WebSocket origin connector.
- Add binary stream envelopes and flow-control limits.
- Add routeKey-based stream opening and daemon-side registry lookup; no route may
  pass a raw port to the daemon connector.
- Add preview-origin template resolution and the safe fallback/unavailable state
  for deployments without resource-scoped origin isolation.

Exit: web and native clients can render a registered dev server through Happier,
and Vite/Next HMR works.

### Phase 5: URL Rewriting And Hardening

- Add streaming HTML/CSS rewriting.
- Add CSP coordinator.
- Add runtime interceptor and strict-CSP fallback.
- Add metrics and debug diagnostics.

Exit: common localhost absolute URLs, runtime-created WebSockets, and strict CSP
fixtures are covered.

## Test Plan

Follow TDD for every behavior-changing phase.

Phase 1 target tests:

- `packages/protocol/src/structuredMessages/webPreviewV1.test.ts`
- `packages/protocol/src/features/catalog.test.ts`
- `packages/protocol/src/features/payload/featureGatesSchema.test.ts`
- `packages/protocol/src/actions/actionSpecs.test.ts`
- `apps/server/sources/app/features/catalog/resolveServerFeaturePayload.spec.ts`
- `apps/cli/src/mcp/createHappierMcpServer.test.ts`
- `apps/cli/src/mcp/startHappyServer.test.ts` or the existing integration test
  that snapshots exposed tool names
- `apps/cli/src/agent/tools/happierTools/*.test.ts`
- absence tests proving old experimental tool names and
  `local_service_preview.v1` are not exposed

Phase 2 target tests:

- `apps/cli/src/session/webPreview/*.test.ts`
- start/register idempotency tests for `(sessionId, machineId, cwd, port)`
- close tests proving owned processes stop and externally registered processes
  are not killed
- list/status side-effect and health-refresh tests
- `apps/ui/sources/components/sessions/transcript/MessageView.structured.test.tsx`
- `apps/ui/sources/components/sessions/panes/SessionDetailsPanel*.test.tsx`
- UI pane tests for loading, unavailable, dead, closed, reload, and close states

Phase 4 target tests:

- server route tests with real HTTP requests
- server feature payload test proving `sessions.webPreview.relay` is not
  disabled by a missing parent support bit when the server allows it
- socket stream protocol tests with binary chunks
- daemon connector tests against in-process HTTP and WebSocket servers
- integration test for Vite HMR or a minimal WebSocket echo dev server
- security regression test: crafted preview URL with an unregistered `routeKey`
  never reaches any loopback port
- feature regression test: disabled `sessions.webPreview.relay` rejects token and
  route access
- origin regression test: script-capable preview HTML is not served under the
  main Happier app origin or a shared unsandboxed preview origin
- credential regression test: Happier auth cookies and authorization headers are
  never forwarded to the local dev server
- cookie isolation regression test: upstream `Set-Cookie` is either
  resource-origin isolated, namespaced to the route, or dropped with a visible
  limitation

Phase 5 target tests:

- streaming HTML first-chunk timing
- CSP header matrix
- runtime interceptor jsdom matrix
- strict-CSP Service Worker fallback fixture

Before handoff for implementation work, run the touched-package typecheck lanes
and at least one broader related test lane.

## Risks And Mitigations

- Agent keeps starting duplicate previews. Mitigation: `list`/`status` are part
  of the prompt contract, and `start`/`register` reuse existing active previews
  by default.
- Removing old experimental names breaks an internal dogfood workflow.
  Mitigation: this is intentional for a test feature; the migration must update
  all first-party callers in the same vertical slice and absence tests prevent
  dual surfaces from returning.
- Wrong port registration. Mitigation: health state is visible; registration is
  idempotent; `replace` lets the agent or user correct it.
- Relay turns into a parallel transport stack. Mitigation: keep ownership in
  protocol/server/CLI machine socket layers and reuse existing authorization and
  feature-gating patterns.
- Preview content gains main-app or cross-preview origin privileges. Mitigation:
  relay is blocked on resource-scoped preview-origin routing or a sandboxed
  degraded mode; route handlers must refuse unsafe same-origin/shared-origin HTML
  serving.
- WebSocket/HMR edge cases. Mitigation: preserve subprotocol, frame type, and
  close code; test against Vite and a raw `ws` fixture.
- Rewriter delays streaming SSR. Mitigation: rewriting is a later slice with a
  timing gate.

## Out Of Scope

- Public share links for Web Preview.
- Exposing arbitrary local network hosts.
- Browser automation.
- Keeping old experimental tool names, schemas, feature ids, or UI resources.
