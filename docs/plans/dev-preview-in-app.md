# Dev Preview Inside Happier

> Status: revised Happier plan, 2026-05-15.
>
> This replaces the earlier "plain transcript URL" direction. It borrows the useful
> parts of `/Users/ab/workspace/happy/docs/plans/dev-preview-in-app.md` and
> `/Users/ab/workspace/happy/docs/plans/dev-preview-url-rewriting.md`, but adapts
> them to Happier's current architecture: feature catalog, built-in MCP tools,
> `meta.happier` structured messages, details-pane tabs, and machine-scoped socket
> transport.

## Decision Summary

- Dev preview is a first-class session resource, not a raw `127.0.0.1` link in the transcript.
- Discovery is MCP/tool-first. v1 does not include log regexes, stdout sniffing, or port scanning.
- The UI entry point is a structured transcript card that opens a details-pane preview tab.
- The live preview relay must support HTTP streaming and WebSocket/HMR before it is considered complete.
- Script-capable preview content must be origin-isolated from the main Happier app. If no safe preview origin or sandbox mode is available, the preview pane shows an unavailable state instead of serving the app under the main origin.
- Happier should reuse existing socket, feature-gating, session, and machine concepts. Do not copy old Happy package paths or introduce a parallel `happy-wire` style subsystem.
- URL rewriting is a later hardening slice after the basic resource, registration, and relay contracts are stable. The rewriting design is captured in [dev-preview-url-rewriting.md](./dev-preview-url-rewriting.md).

## Problem

When an agent starts a local web dev server during a Happier session, the user needs a reliable way to view the running app from the Happier client. A plain text URL is not enough:

- `127.0.0.1` means the daemon machine, not the user's phone or remote browser.
- A transcript link cannot express machine identity, health, rewrite policy, token state, or HMR support.
- External tunnels add setup burden and create a second security model.
- Visual Runner solves browser automation and evidence capture, not a live user-controlled preview surface.

## Goals

- Let a session agent register a local dev server running on the session machine.
- Render the registered server in the Happier app/web client through a details pane.
- Preserve modern dev-server behavior: streaming HTML, assets, SSE, and WebSocket HMR.
- Keep preview access scoped to the authenticated Happier session, machine, and device.
- Make the implementation testable in small vertical slices with TDD for every behavior change.

## Industry Baseline

The `plan-review` skill's `BENCHMARKS.md` is compiler-oriented and has no entry for localhost tunneling or streaming proxy systems. This plan therefore carries the relevant benchmark registry locally. Future implementation work can move this section into a repo-wide benchmark file if this feature becomes a broader platform primitive.

| System | Concrete module / mechanism | Happier design consequence |
| --- | --- | --- |
| VS Code Dev Tunnels / GitHub Codespaces | `microsoft/dev-tunnels` WebSocket relay stream modules such as `WebSocketStream` and `TunnelRelayStreamFactory`; port forwarding rides stream channels and preserves WebSocket upgrades. | Happier's relay phase must be stream-multiplexed and WebSocket-native, not a request/response RPC wrapper. |
| GitHub Codespaces forwarded ports | Forwarded ports are exposed on separate browser origins instead of being embedded as script-capable content under the IDE's primary origin. | Happier must treat per-resource origin isolation as a security requirement, not just a UI detail. |
| cloudflared | Cloudflare Tunnel HTTP/2 or QUIC stream forwarding. | Body bytes stay binary on the hot path; Happier must not base64 HTTP or WebSocket bodies. |
| ngrok / frp / wstunnel | yamux/smux or HTTP/2-like multiplexed tunnels. | One logical stream per HTTP request or WebSocket session; no head-of-line blocking through one serialized RPC. |
| Cloudflare Workers `HTMLRewriter` / `lol-html` | Token-level streaming HTML transformation. | URL rewriting must preserve early chunk delivery and cannot buffer a full SSR document. |
| StackBlitz WebContainer | Service Worker network interception for in-browser dev servers. | Service Worker mode is a strict-CSP fallback, not the primary mode, because fetch interception does not fully cover WebSocket/EventSource. |

These references are why the plan requires stream multiplexing, binary body chunks, native WebSocket support, and streaming HTML rewriting.

## Non-goals For v1

- Public sharing of dev preview URLs.
- Native Expo Dev Client preview on mobile. Expo deep links can be a later provider-specific enhancement.
- Browser automation. That remains Visual Runner's job.
- Regex-based auto-discovery of dev servers.
- Rewriting JavaScript or JSON response bytes.

## Existing Happier Anchors

Use these instead of inventing side systems:

- Feature catalog: `packages/protocol/src/features/catalog.ts`
- CLI feature decisions: `apps/cli/src/features/featureDecisionService.ts`
- UI feature decisions: `apps/ui/sources/sync/domains/features/featureDecisionRuntime.ts`
- Built-in session MCP server: `apps/cli/src/mcp/createHappierMcpServer.ts`
- Built-in tool catalog and dispatch: `apps/cli/src/agent/tools/happierTools/*`
- Structured message envelope: `packages/protocol/src/structuredMessages/HappierMetaEnvelope.ts`
- UI structured message registry: `apps/ui/sources/components/sessions/transcript/structured/structuredMessageRegistry.tsx`
- Details pane: `apps/ui/sources/components/sessions/panes/SessionDetailsPanel.tsx`
- Machine transfer and socket routing references: `packages/protocol/src/socketRpc.ts`, `apps/server/sources/app/api/socket/machineTransferHandler.ts`, `apps/cli/src/machines/transfer/*`

## Feature Gates

Add feature ids through the canonical catalog:

- `sessions.devPreview`
  - representation: `client`
  - dependency: `sessions`
  - owns UI affordances, CLI local policy, prompt suffix, and MCP tool availability.
  - settings: experimental UI toggle, `showInSettings: true`, `defaultEnabled: false`.
- `sessions.devPreview.relay`
  - representation: `server`
  - dependency: `sessions.devPreview`
  - owns server preview-token routes and server-routed preview streams.
  - server default: allow unless build policy or server config denies it, so the UI can still show the client opt-in toggle.

Use feature decisions everywhere. Do not gate on raw env vars, raw `/v1/features` payload poking, or capability fields.

Because server dependency enforcement reads enabled-bit paths from the `/v1/features` payload, the server resolver for `sessions.devPreview.relay` must also populate the parent support bit at `features.sessions.devPreview.enabled`. That bit means "server supports the parent feature"; it is not the user's local opt-in. UI and CLI decisions must still combine it with the local/account-settings policy before exposing UI, prompts, or tools.

## Protocol Contract

Add a structured message payload in `packages/protocol/src/structuredMessages/localServicePreviewV1.ts`.

Envelope:

```ts
{
  kind: "local_service_preview.v1",
  payload: LocalServicePreviewV1
}
```

Draft payload shape:

```ts
type LocalServicePreviewV1 = {
  resourceId: string;
  sessionId: string;
  machineId: string;
  port: number;
  name?: string;
  framework?: "vite" | "next" | "webpack" | "cra" | "expo-web" | "astro" | "sveltekit" | "other";
  source: "mcp_tool" | "manual";
  registeredAtMs: number;
  health: {
    status: "unknown" | "checking" | "ready" | "dead";
    checkedAtMs?: number;
  };
  preview: {
    rewriteUrls: boolean;
    supportsWebSocket: boolean;
    routeKey: string;
  };
};
```

Rules:

- No signed preview token in transcript metadata.
- No raw relay URL in the durable transcript contract.
- `resourceId` is a stable registry identity for `(sessionId, machineId, port)`; it is used only for lookup and must not be decoded into a port.
- `routeKey` is an opaque per-registration route handle. Server and daemon code must look it up in a registry instead of deriving port access from the URL.
- Forked sessions do not inherit active preview resources.

## Registration Contract

Add the registration tool as an ActionSpec-backed Happier tool, not as an ungated manual MCP tool:

- Add `session.devPreview.register` to `packages/protocol/src/actions/actionIds.ts`.
- Add its ActionSpec in `packages/protocol/src/actions/actionSpecs.ts` with `bindings.mcpToolName = "happier_dev_preview_register"` and `surfaces.session_agent = true`.
- Extend `ActionSpec` with `requiredFeatureId?: FeatureId` and set `requiredFeatureId: "sessions.devPreview"` on this action.
- Extend action-spec discovery and built-in tool filtering so a tool is exposed only when both action enablement and the required feature decision are enabled.
- Implement the action in the CLI action executor path, so `createHappierMcpServer.ts` can continue dispatching through the existing action-backed tool bridge.

This keeps tool availability rooted in one catalog: ActionSpec owns the tool name, input schema, action enablement, approval policy, and feature requirement. Do not add a parallel manual-tool feature registry.

Availability must be checked through one composite helper, for example `isActionSpecAvailableForSurface(spec, ctx)`, rather than adding feature checks only to the tool listing path. The same helper must cover:

- `startHappyServer.ts` tool-name snapshots
- `registerHappierMcpResources.ts` action-spec resources
- `createActionToolExecutorBridge.ts` and direct action tool dispatch
- `action_spec_search`, `action_spec_get`, and `action_options_resolve`
- `action_execute` and direct action-id execution

For the session-agent MCP surface, `requiredFeatureId` is resolved with the CLI feature decision service. `sessions.devPreview` is client-represented, so this registration tool does not require a server snapshot; it does require the account/settings-backed experimental toggle to be enabled. Extend the CLI feature decision inputs to accept account settings and reuse `apps/cli/src/features/settingsFeatureToggles.ts` instead of making an env-only decision for this tool. `sessions.devPreview.relay` remains server-gated at the token and route layers.

Tool name:

```text
happier_dev_preview_register
```

Input:

```ts
{
  port: number;          // 1..65535
  name?: string;         // friendly label
  framework?: string;    // normalized to the protocol enum
  rewriteUrls?: boolean; // default true
  healthPath?: string;   // default "/"
}
```

Behavior:

- Idempotent for the same `(sessionId, machineId, port)`.
- Rejects non-loopback hosts; the tool accepts ports only, not arbitrary URLs.
- `healthPath` is path-only, must start with `/`, and must not contain a scheme or host.
- Updates the per-session registry and emits a `local_service_preview.v1` structured message/card.
- The system-prompt suffix and tool exposure are both enabled only when the `sessions.devPreview` feature decision is enabled.

The prompt should instruct the agent to call the tool after commands like `npm run dev`, `yarn dev`, `pnpm dev`, `bun dev`, `vite`, `next dev`, `astro dev`, and `sveltekit dev`.

## CLI Runtime Registry

Create an owning CLI domain under:

```text
apps/cli/src/session/devPreview/
```

Initial modules:

- `createSessionDevPreviewRegistry.ts`
- `normalizeDevPreviewRegistration.ts`
- `createSessionDevPreviewHealthChecker.ts`
- `emitLocalServicePreviewMessage.ts`

Registry behavior:

- In-memory and session-scoped.
- Keyed by `(sessionId, machineId, port)`.
- Stores `resourceId -> port` and `routeKey -> resourceId`; preview streams may resolve ports only through these maps.
- Health checker attempts a bounded TCP connect to `127.0.0.1:<port>`.
- Mark dead after a configurable grace period, defaulting to 30 seconds.
- Do not unregister on the first failed check; dev servers often restart.
- Manual registration uses the same registry path as the MCP tool.

## UI Contract

The transcript card is only an entry point. It should not be the live preview container.

Implementation surface:

- Add `local_service_preview.v1` to `StructuredMessageKind`.
- Add `LocalServicePreviewMessageCard`.
- The card opens a details tab with `resource.kind === "localServicePreview"`.
- Add a built-in details-pane renderer in `SessionDetailsPanel.tsx` for `localServicePreview`.
- The preview tab owns loading, unavailable, dead-port, and unsupported-client states.

Preview component shape:

```ts
type SessionLocalServicePreviewPaneProps = {
  resourceId: string;
  sessionId: string;
  scopeId: string;
  machineId: string;
  port: number;
  routeKey: string;
  rewriteUrls: boolean;
  supportsWebSocket: boolean;
  name?: string;
};
```

Web should use an `iframe`. Native should use the existing app WebView pattern if available; if no relay is available, native must show an explicit unavailable state instead of trying to open the daemon machine's loopback URL.
The pane must treat `routeKey` as required for any server-routed relay request. `port` is display metadata and a same-machine development fallback only; it is never sent to the server route as an authority to connect.

## Transport And Relay Contract

The relay slice must be built as a session/machine stream, not as file transfer and not as request/response RPC.

Preferred shape:

- Add a dev-preview stream protocol under `packages/protocol/src/sessionDevPreview/`.
- Add a socket event similar in spirit to `MACHINE_TRANSFER_ENVELOPE`, but with preview-specific envelopes and binary body chunks.
- Use Socket.IO binary payloads for response/request body bytes. Do not base64 body chunks.
- Route by `(accountId, sessionId, sourceMachineId, streamId)`.
- Keep machine-scoped authorization checks aligned with existing machine-transfer handling.

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
ANY /preview/:sessionId/:machineId/:routeKey/*
```

Token route:

```text
POST /v1/sessions/:sessionId/dev-preview-token
GET  <previewOrigin>/preview-token-redirect
```

Token request shape:

```ts
type DevPreviewTokenRequest = {
  machineId: string;
  routeKey: string;
  returnPath?: string; // path/query/hash under the preview resource
};
```

The `POST` response returns a preview-origin redirect URL for `GET <previewOrigin>/preview-token-redirect` with a one-time exchange code, not a reusable bearer token. The redirect handler runs on the resolved resource-scoped preview origin, consumes the code, sets a host-scoped preview cookie for that origin, and redirects to the resource path. The main Happier app origin must not set cookies for preview origins.

Origin isolation requirements:

- Production web/native relay URLs resolve through a configured preview-origin template, for example `HAPPIER_PUBLIC_PREVIEW_ORIGIN_TEMPLATE`.
- Preferred production mode is resource-scoped origin isolation, such as `https://<routeKey>.<previewBaseHost>`, so cookies, localStorage, IndexedDB, and service workers are not shared across preview resources or with the main Happier app.
- The path shape remains `/preview/:sessionId/:machineId/:routeKey/*`, but script-capable HTML must not be served under the main app origin. The main origin may redirect to the preview origin or return an unavailable response.
- A shared preview origin or same-origin path mode is allowed only as a restricted fallback with an iframe sandbox that omits `allow-same-origin` and prevents origin-wide storage sharing. If that breaks a framework's fetch/XHR/HMR behavior, the pane must show the limitation instead of silently weakening the sandbox.
- `routeKey` is an opaque routing handle, not an auth secret.

Transport requirements:

- One stream per HTTP request or WebSocket session.
- Preserve HTTP method, path, query, allowed headers, status, and response headers.
- Preserve WebSocket text vs binary frames and close codes.
- Support SSE by streaming chunks without buffering the full response.
- Enforce per-stream byte/window limits to prevent unbounded buffering.
- Preview token scope includes `(accountId, sessionId, machineId, routeKey, deviceId where available)`.
- The token redirect uses a one-time exchange code and sets a short-lived, `HttpOnly`, `Secure`, host-scoped preview cookie on the resource-scoped preview origin before redirecting to the preview path; token material is not left in durable URLs, and preview responses use `Referrer-Policy: no-referrer`.
- The relay strips Happier app credentials before forwarding upstream. It consumes the preview auth cookie internally and forwards only cookies that came from the upstream dev server through this route's cookie isolation layer.
- Upstream `Set-Cookie` is accepted only when it is isolated by a resource-scoped preview origin or rewritten into the route's cookie namespace; otherwise the relay drops it and reports a preview limitation.
- The server route validates account/session/machine/token scope, then opens a stream by `routeKey`; it must not accept a raw port from the URL.
- The daemon is the authoritative port gate: it resolves `routeKey -> resourceId -> port` from its session registry and rejects missing, dead, or feature-disabled entries before connecting to loopback.
- A server-side registry mirror may be added for faster 404s, but it is advisory. The daemon lookup is the security boundary that prevents arbitrary port access.

## Performance Budgets

All values are initial configurable budgets and must be enforced by tests or diagnostics before a phase exits.

| Budget | Target |
| --- | --- |
| Registration-to-card update | p95 under 1 s on a healthy local session socket |
| HTTP HTML relay overhead | p50 under 200 ms and p99 under 750 ms over a 50 ms RTT relay |
| Static asset relay overhead | p50 under 150 ms and p99 under 500 ms over a 50 ms RTT relay |
| WebSocket/HMR roundtrip | p50 under 300 ms and p99 under 1 s over a 50 ms RTT relay |
| First transformed HTML chunk | emitted within 10 ms of the upstream chunk in the streaming rewriter benchmark |
| Per-frame body payload | bounded and configurable; initial cap no larger than 16 MiB |
| Per-stream in-flight data | bounded and configurable; initial cap no larger than 32 MiB |

If a target cannot be met in implementation, the phase must either tighten the design or explicitly move the feature behind a narrower experimental gate with documented limits.

## URL Rewriting

Do not implement URL rewriting before the basic resource and relay contract is green.

When implemented, follow [dev-preview-url-rewriting.md](./dev-preview-url-rewriting.md):

- Streaming HTML rewriting only.
- HTML/CSS rewriting for loopback absolute URLs and root-relative same-dev-server URLs.
- CSS `url(...)` and `@import` rewriting only for URL tokens, not arbitrary CSS text mutation.
- CSP nonce coordination.
- Runtime interceptor for `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource`.
- Service Worker fallback only for incompatible CSP.
- No JavaScript or JSON body rewriting.

## Security

- Dev servers remain loopback-only on the session machine.
- Registration accepts a port, not an arbitrary host.
- Preview tokens are short-lived and bound to session, machine, account, and device where available.
- Tokens are never written into transcript metadata or structured messages.
- Web iframe/WebView storage is isolated through a resource-scoped preview origin when available, or through a sandboxed degraded mode that does not grant same-origin access to the main Happier app or other preview resources.
- Server route denies access when the feature gate is disabled, the session is inaccessible, the machine is not owned by the account, or the port is not registered.
- Strip or block hop-by-hop headers at the relay boundary.

## Implementation Phases

### Phase 1: Contract And Registration

- Add feature ids and protocol schema.
- Add UI registry/local-policy entries for `sessions.devPreview` with experimental `defaultEnabled: false`, plus CLI local-policy support for account-settings feature toggles.
- Add `/v1/features` gate schema and server resolver support bits for `features.sessions.devPreview.enabled` and `features.sessions.devPreview.relay.enabled`.
- Add CLI registry and health checker.
- Add `session.devPreview.register` ActionSpec and expose `happier_dev_preview_register` through the action-backed built-in tool path.
- Add required-feature filtering for ActionSpec-backed tools and verify disabled `sessions.devPreview` hides the tool.
- Emit `local_service_preview.v1` structured messages.
- Add the UI transcript card and details-tab shell.

Exit: an agent can register a port and the user sees a structured preview resource that opens a details tab. Live relay may still show an explicit "relay unavailable" state.

### Phase 2: Same-machine Web Preview

- For local-development web/desktop clients running on the daemon machine over a loopback HTTP origin, allow the details tab to load a local iframe URL behind the feature gate.
- Do not claim this works for production HTTPS web clients; mixed-content and remote-loopback semantics require the Phase 3 relay.
- Keep native clients in the unavailable state unless the relay feature is available.

Exit: local web can render Vite/Next via the structured preview tab without putting raw URLs in the transcript contract.

### Phase 3: Server-routed HTTP And WebSocket Relay

- Add preview token routes.
- Add server preview route.
- Add daemon-side HTTP and WebSocket origin connector.
- Add binary stream envelopes and flow-control limits.
- Add routeKey-based stream opening and daemon-side registry lookup; no route may pass a raw port to the daemon connector.
- Add preview-origin template resolution and the safe fallback/unavailable state for deployments without resource-scoped origin isolation.

Exit: web and native clients can render a registered dev server through Happier, and Vite/Next HMR works.

### Phase 4: URL Rewriting And Hardening

- Add streaming HTML/CSS rewriting.
- Add CSP coordinator.
- Add runtime interceptor and strict-CSP fallback.
- Add metrics and debug diagnostics.

Exit: common localhost absolute URLs, runtime-created WebSockets, and strict CSP fixtures are covered.

## Test Plan

Follow TDD for every behavior-changing phase.

Phase 1 target tests:

- `packages/protocol/src/structuredMessages/localServicePreviewV1.test.ts`
- `packages/protocol/src/features/catalog.test.ts`
- `packages/protocol/src/features/payload/featureGatesSchema.test.ts`
- `packages/protocol/src/actions/actionSpecs.test.ts`
- `apps/server/sources/app/features/catalog/resolveServerFeaturePayload.spec.ts`
- `apps/cli/src/session/devPreview/*.test.ts`
- `apps/cli/src/mcp/createHappierMcpServer.test.ts`
- `apps/cli/src/mcp/startHappyServer.test.ts` or the existing integration test that snapshots exposed tool names
- `apps/cli/src/agent/tools/happierTools/*.test.ts`
- `apps/ui/sources/components/sessions/transcript/MessageView.structured.test.tsx`
- `apps/ui/sources/components/sessions/panes/SessionDetailsPanel*.test.tsx`
- UI preview pane test proving relay mode requires `routeKey` and never builds a server route from `port`

Phase 3 target tests:

- server route tests with real HTTP requests
- server feature payload test proving `sessions.devPreview.relay` is not disabled by a missing parent support bit when the server allows it
- socket stream protocol tests with binary chunks
- daemon connector tests against in-process HTTP and WebSocket servers
- integration test for Vite HMR or a minimal WebSocket echo dev server
- security regression test: crafted preview URL with an unregistered `routeKey` never reaches any loopback port
- feature regression test: disabled `sessions.devPreview.relay` rejects token and route access
- origin regression test: script-capable preview HTML is not served under the main Happier app origin or a shared unsandboxed preview origin
- credential regression test: Happier auth cookies and authorization headers are never forwarded to the local dev server
- cookie isolation regression test: upstream `Set-Cookie` is either resource-origin isolated, namespaced to the route, or dropped with a visible limitation

Phase 4 target tests:

- streaming HTML first-chunk timing
- CSP header matrix
- runtime interceptor jsdom matrix
- strict-CSP Service Worker fallback fixture

Before handoff for implementation work, run the touched-package typecheck lanes and at least one broader related test lane.

## Risks And Mitigations

- Agent does not call the registration tool. Mitigation: manual registration uses the same registry; revisit hook fallback only if dogfooding shows sustained miss rate.
- Wrong port registration. Mitigation: health state is visible; registration is idempotent; manual override can register the correct port.
- Relay turns into a parallel transport stack. Mitigation: keep ownership in protocol/server/CLI machine socket layers and reuse existing authorization and feature-gating patterns.
- Feature-gated tool exposure drifts from ActionSpec discovery. Mitigation: `requiredFeatureId` lives on the ActionSpec and the same filter powers tool listing, action-spec search, and direct dispatch.
- Preview content gains main-app or cross-preview origin privileges. Mitigation: Phase 3 is blocked on resource-scoped preview-origin routing or a sandboxed degraded mode; route handlers must refuse unsafe same-origin/shared-origin HTML serving.
- WebSocket/HMR edge cases. Mitigation: preserve subprotocol, frame type, and close code; test against Vite and a raw `ws` fixture.
- Rewriter delays streaming SSR. Mitigation: rewriting is a later slice with a timing gate.

## Out Of Scope

- Public share links for dev preview.
- Exposing arbitrary local network hosts.
- Browser automation.
- Reusing old Happy worktree instructions, branch names, or package paths.
