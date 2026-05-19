# Dev Preview URL Rewriting

> Status: revised Happier sub-plan, 2026-05-15.
>
> Parent plan: [dev-preview-in-app.md](./dev-preview-in-app.md).

## Purpose

The preview relay can proxy a registered local dev server, but many dev servers emit localhost-bound URLs and root-relative same-dev-server URLs in HTML, CSS, or runtime JavaScript calls. Those URLs must be rewritten to the Happier preview route or they break in remote web, mobile WebView, and HTTPS relay contexts.

This subsystem is intentionally deferred until the basic preview resource and relay are working.

## Goals

- Preserve streaming HTML. Do not buffer a full document before sending bytes downstream.
- Rewrite localhost-bound and root-relative same-dev-server URLs in HTML attributes and CSS.
- Inject a small runtime interceptor for URLs created by `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource`.
- Coordinate Content-Security-Policy with nonce injection.
- Keep HMR working through the relay.

## Industry Baseline

The `plan-review` skill's `BENCHMARKS.md` has no URL-rewriting entry, so this sub-plan carries its own concrete benchmark list:

- Cloudflare Workers `HTMLRewriter` and the underlying `lol-html` tokenizer are the benchmark for token-level streaming HTML transformation.
- GitHub Codespaces forwarded ports demonstrate the CSP coordination problem when helper scripts are injected into proxied pages.
- GitHub Codespaces and VS Code forwarded ports also keep previewed apps on per-resource browser origins, which prevents a proxied dev app from inheriting the IDE/app origin or another forwarded port's storage.
- StackBlitz WebContainer demonstrates Service Worker network interception, with the important limitation that WebSocket and EventSource are not fully covered by fetch interception.
- ngrok-style pass-through tunnels show the opposite trade-off: when the URL model already makes every asset same-origin, rewriting can be avoided. Happier does not have that guarantee because the origin page may emit raw localhost URLs.

## Non-goals

- Rewriting JavaScript response bytes.
- Rewriting JSON response bytes.
- Rewriting images, fonts, wasm, or video.
- Guaranteeing every framework edge case in the first hardening slice.

## Server Location

Use a single owning server domain, for example:

```text
apps/server/sources/app/devPreview/
```

Suggested modules:

- `rewritePreviewHtmlStream.ts`
- `rewritePreviewCssUrls.ts`
- `rewritePreviewContentSecurityPolicy.ts`
- `createPreviewRuntimeInterceptorSource.ts`
- `createPreviewServiceWorkerSource.ts`
- `resolvePreviewUrlRewritePolicy.ts`

Do not scatter rewriter logic inside the route handler.

## Rewriting Rules

Rewrite only these URL classes:

- URLs that target registered loopback hosts: `localhost`, `127.0.0.1`, or `[::1]`.
- Root-relative same-dev-server URLs such as `/@vite/client`, `/src/main.ts`, `/api/...`, and `/assets/...` that would otherwise escape the `/preview/:sessionId/:machineId/:routeKey/` route prefix.

Do not rewrite document-relative URLs that already resolve under the current preview resource path, and do not rewrite external hosts.

Allowed schemes:

- `http:`
- `https:`
- `ws:`
- `wss:`

Target shape:

```text
<previewOrigin>/preview/:sessionId/:machineId/:routeKey/*
```

`previewOrigin` must be resource-scoped when script-capable content is served, for example `https://<routeKey>.<previewBaseHost>`. A shared preview origin is allowed only in sandboxed degraded mode without `allow-same-origin`. Preserve path, query, and hash. Do not inject preview tokens into rewritten URLs. The rewriter receives a registry map of `localhost port -> routeKey`; it must not derive route keys from port values.

## Streaming HTML Rewriter

Use a streaming parser. The old Happy plan suggested `parse5-sax-parser`; that remains a reasonable default if benchmarking passes against the budgets below.

Rewrite these attributes when they contain loopback URLs or root-relative same-dev-server URLs:

- `src`
- `href`
- `action`
- `formaction`
- `srcset`
- `poster`
- `manifest`
- `data`
- `cite`
- `longdesc`
- `meta[http-equiv=refresh] content`

Inject the runtime interceptor after `<head>` when possible. If no `<head>` appears, inject after `<html>`. If neither appears, do not buffer the entire response waiting for a perfect insertion point; emit a documented degraded response.

Streaming constraints:

- Flush transformed output as tokens complete.
- Keep the maximum buffered window bounded.
- Preserve chunked/SSE-like behavior for SSR frameworks.
- Emit the first transformed chunk within 10 ms of the first upstream chunk in the 50 KB / 5 KB-chunk benchmark.
- Keep ordinary token buffering under 64 KiB; if a single token exceeds the hard cap, fail the response with a structured preview error instead of buffering unboundedly.

## CSS Rewriter

Rewrite loopback URLs and root-relative same-dev-server URLs inside:

- `url(...)`
- `@import "..."`
- `@import url(...)`

Never rewrite:

- `data:`
- `blob:`
- `file:`
- non-loopback hosts
- document-relative URLs that already resolve under the current preview resource path

## CSP Coordinator

The coordinator runs before HTML injection.

Rules:

- If there is no CSP, generate a nonce and inject normally.
- If `script-src` exists and can accept a nonce, add `'nonce-<value>'`.
- If only `default-src` exists, apply script fallback semantics and add the nonce where required.
- If there are multiple CSP headers, each must remain valid.
- Never strip CSP to make injection easy.
- If CSP is incompatible, switch to Service Worker fallback mode.

Strict cases that should trigger fallback:

- `script-src 'none'`
- incompatible `strict-dynamic`
- any policy where adding a nonce would still not allow the interceptor script

## Runtime Interceptor

The interceptor should be a small committed source string, not generated ad hoc in the route.

Patch:

- `window.fetch`
- `XMLHttpRequest.prototype.open`
- `window.WebSocket`
- `window.EventSource`

Patch hygiene:

- Idempotent guard, for example `window.__happierDevPreviewPatched__`.
- Chain with framework patches instead of replacing them blindly.
- Rewrite only loopback absolute URLs and same-dev-server root-relative or relative URLs that need relay routing, using the injected `port -> routeKey` map.
- Never rewrite runtime-created URLs to the main Happier app origin or to an unsandboxed shared preview origin. If no resource-scoped preview origin or sandbox-compatible mode is available, leave the pane in an unavailable or degraded state.
- Preserve method arguments and constructor behavior.

## Service Worker Fallback

Use only when CSP prevents runtime script injection.

Scope:

```text
<previewOrigin>/preview/:sessionId/:machineId/:routeKey/
```

Capabilities:

- Can rewrite `fetch` traffic.
- Cannot reliably rewrite `WebSocket` or `EventSource`.
- Must be registered only on a resource-scoped preview origin, never on the main Happier app origin or an unsandboxed shared preview origin.

The preview pane must surface this limitation when fallback mode is active.

## Tests

All implementation work follows RED-GREEN-REFACTOR.

Required tests:

- Streaming HTML fixture that emits chunks and proves the first transformed chunk is not delayed by full-document buffering.
- One test per rewritten HTML attribute.
- `srcset` multi-URL rewriting.
- Root-relative HTML asset rewriting, including Vite-style `/@vite/client`.
- CSS `url(...)`, root-relative `url(...)`, and `@import` rewriting.
- CSP matrix: no CSP, `script-src 'self'`, `default-src 'self'`, multiple headers, `script-src 'none'`, incompatible `strict-dynamic`.
- jsdom interceptor tests for `fetch`, XHR, WebSocket, and EventSource.
- jsdom interceptor tests for root-relative `fetch('/api')`, `new WebSocket('/hmr')`, and `new EventSource('/events')`.
- Integration test through the preview route with a minimal dev server that emits absolute localhost URLs.
- Security regression test: a URL for localhost port without a registry routeKey is not rewritten into a usable preview route.
- Origin regression test: rewritten URLs target the configured resource-scoped preview origin and never the main Happier app origin or an unsandboxed shared preview origin.

## Exit Criteria

- Vite HMR works through the relay.
- Next-style strict CSP fixture uses nonce path or fallback with a visible limitation state.
- Streaming SSR fixture preserves early chunk delivery.
- No JavaScript or JSON body bytes are mutated.
