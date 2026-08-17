# Webhook Delivery Profile Design

## Goal

Make Happier activity webhooks usable with both developer-owned HTTP endpoints and third-party webhook receivers that require their own request shape, while keeping the internal notification event model stable.

This is not a Feishu-specific integration. Feishu exposed the current limitation: Happier sends a fixed JSON payload and treats HTTP 2xx as delivery success, while many webhook receivers require a specific body shape and may return business errors inside a 2xx response.

## Current Behavior

Webhook notification channels currently store a URL, optional signing secret, enabled state, topic switches, and ready-message preview preference.

When an activity notification is dispatched, the CLI builds a canonical Happier activity payload and posts it directly to the configured URL as JSON. If a signing secret exists, the body is signed into the `x-happier-signature-256` header. Delivery is considered successful when the HTTP response status is in the 2xx range.

This works for endpoints that understand Happier's activity payload, but it fails for receivers that expect a different shape, such as chat bot webhooks. It also hides failures when a receiver returns HTTP 200 with an error payload.

Relevant files:

- `packages/protocol/src/account/settings/notificationChannels.ts`
- `packages/protocol/src/activity/webhookPayload.ts`
- `apps/cli/src/activity/notifications/sendWebhookActivityNotification.ts`
- `apps/cli/src/activity/notifications/dispatchActivityNotification.ts`
- `apps/ui/sources/components/settings/notifications/NotificationsSettingsView.tsx`

## Design

Keep `ActivityWebhookPayloadV1` as the canonical event format. Every notification is still normalized into the same internal payload. Add a configurable delivery profile to webhook channels that maps the canonical event into the outbound HTTP request.

The data flow becomes:

```text
ActivityNotificationEvent
  -> buildActivityNotificationContent()
  -> buildActivityWebhookPayload()
  -> renderWebhookDeliveryRequest()
  -> signWebhookRequest()
  -> fetch()
  -> validateWebhookDeliveryResponse()
```

The mapping layer is generic. It does not know about Feishu, Slack, Discord, DingTalk, WeCom, or any other receiver. Presets may be added later, but presets only generate generic delivery profile config.

## Delivery Profile

Add an optional `delivery` field to `WebhookNotificationChannelV1`.

Conceptual shape:

```ts
type WebhookDeliveryV1 = {
  version: 1;
  request: {
    method?: 'POST';
    headers?: Record<string, string>;
    body:
      | { kind: 'happier_activity_v1' }
      | { kind: 'json_template'; template: JsonTemplateValue }
      | { kind: 'text_template'; template: string };
  };
  auth?: {
    kind: 'none' | 'hmac_header';
    algorithm?: 'sha256';
    headerName?: string;
  };
  success?: {
    httpStatus?: { min: number; max: number };
    jsonEquals?: Array<{ path: string; value: unknown }>;
  };
};
```

`JsonTemplateValue` is a JSON value whose string leaves may contain template variables. Objects and arrays preserve their shape; only string values are interpolated.

If `delivery.auth` is omitted, it defaults to legacy-compatible HMAC header signing when `signingSecret` is configured and no signing when `signingSecret` is empty. If `delivery.success` is omitted, it defaults to HTTP 2xx.

If `delivery` is missing, the sender uses the current behavior:

- body: `ActivityWebhookPayloadV1`
- method: `POST`
- content type: `application/json`
- signing: `x-happier-signature-256` when `signingSecret` exists
- success: HTTP 2xx

This preserves existing user settings and keeps old webhook consumers working.

### Secret Storage

Version one does not add a second secret field inside `delivery.auth`. HMAC signing uses the existing `WebhookNotificationChannelV1.signingSecret`.

This avoids two competing secret sources during migration:

- `signingSecret: null` means signing has no usable secret even if `delivery.auth.kind` is `hmac_header`.
- `delivery.auth.kind: 'none'` means do not sign even if `signingSecret` is stored.
- `delivery.auth.kind: 'hmac_header'` means sign the final rendered request body with `signingSecret` and write the result to `headerName`, defaulting to `x-happier-signature-256`.

Future auth modes that need distinct secrets should introduce explicit named secret slots instead of overloading the existing signing secret.

### Version One Boundaries

Version one implements only the fields shown in the conceptual shape above:

- request method is always `POST`
- request headers are static strings or template strings
- request body is Happier JSON, Custom JSON, or Custom Text
- signing supports `none` and `hmac_header`
- success validation supports HTTP status range and JSON field equality

The first version does not reserve inactive schema fields for unimplemented behavior. HMAC body signing and response body substring checks can be added in a later schema revision when a confirmed use case needs them. This keeps account settings parse behavior aligned with runtime behavior.

## Prior Art

The design follows common webhook delivery patterns:

- GitHub webhooks send a stable event JSON and sign the raw request body with an HMAC header.
- Stripe webhooks use a stable event envelope plus signed delivery headers and require consumers to validate both transport and payload semantics.
- Slack incoming webhooks and chat bot webhooks require receiver-specific JSON bodies, which motivates templated request bodies rather than a single fixed payload.
- Zapier and Make commonly separate trigger payloads from per-destination field mapping, which matches the canonical-event plus delivery-renderer split.

Happier keeps the same separation: `ActivityWebhookPayloadV1` is the canonical event, and the delivery profile is only an outbound request adapter.


## Payload Formats

The UI should present three payload formats:

- `Happier JSON`: Sends the canonical Happier activity JSON. This is best for developer-owned endpoints and automation tools that can process arbitrary JSON.
- `Custom JSON`: Renders a JSON template from the canonical event. This is best for receivers that require a specific JSON shape.
- `Custom Text`: Renders a plain text body. This is best for simple raw-text endpoints.

The formats differ only in the final request body. The event source, topic settings, delivery pipeline, signing, and success validation remain the same.

## Template Variables

Templates use event variables, not process environment variables. They must never read from `process.env` or the host machine. Variables are deterministic values derived from the current notification event.

Use double-brace interpolation:

```text
{{content.title}}
{{content.body}}
{{topic}}
{{createdAt}}
{{time.iso}}
{{time.local}}
{{session.sessionId}}
{{session.title}}
{{request.requestId}}
{{request.kind}}
{{request.toolName}}
{{request.toolDetails}}
{{navigation.sessionId}}
{{navigation.requestId}}
```

The UI may expose friendly aliases:

```text
{{title}} -> {{content.title}}
{{summary}} -> {{content.body}}
{{time}} -> {{time.local}}
{{session}} -> {{session.title}}
```

`summary` is only an alias for the notification body in the first version. It does not trigger an additional model-generated session summary.

The first version should not support arbitrary JavaScript, conditionals, loops, or function calls. Missing values render as an empty string.

## Safety Limits

Custom delivery profiles must be constrained before rendering or sending:

- Header names must satisfy the HTTP token grammar. Invalid names reject the profile.
- Header values may use templates, but rendered values must not contain carriage return or line feed characters.
- User-provided headers must not override transport-controlled headers that Happier owns for the request, including `host`, `content-length`, and the signing header selected by the profile.
- Template source size must be bounded. Version one should reject any single template string over 16 KiB and any rendered request body over 64 KiB.
- Custom JSON templates must parse as JSON before saving and must render to valid JSON before sending.
- Response bodies used for diagnostics must be truncated before logging or storing. Version one should keep at most the first 4 KiB of response text.
- Logs and UI diagnostics must redact webhook URLs, query tokens, authorization headers, signing secrets, and request bodies.
- Template rendering must never read from process environment variables, files, network resources, or user shell state.

These limits are part of the feature contract and should be covered by tests.

## Success Validation

Delivery success must mean the receiver accepted the notification, not merely that an HTTP request completed.

Default behavior remains HTTP 2xx. Delivery profiles can add extra success rules:

- HTTP status range
- JSON field equals value

For JSON field checks, support a small path syntax such as:

```text
$.code
$.StatusCode
$.data.ok
```

If JSON rules are configured and the response body is not valid JSON, validation fails. The dispatcher should increment `attemptedChannels` but not `deliveredChannels`.

Failure logs should include channel id, topic, HTTP status, failed rule, and a truncated response body. They must not include webhook tokens, full URLs with secrets, signing secrets, or request bodies that may contain sensitive data.

## UI/UX

Do not keep expanding webhook configuration inside the main notifications list. The current page already becomes dense with per-topic switches. Adding payload templates, signing, and success rules there would make the settings hard to scan.

Use a list/detail structure.

### Notifications Page

The notifications page should show webhook rows as summaries:

- title: user-defined name, defaulting to a readable host-based name
- subtitle: enabled topics, payload format, and current status
- right side: enabled switch or row actions
- tap row: open webhook detail page

Example subtitle:

```text
Ready, Permissions, Actions · Custom JSON · Untested
```

### Webhook Detail Page

Group settings by user intent:

1. Destination
   - name
   - URL
   - enabled
   - last test or delivery status

2. Events
   - ready
   - permission requests
   - user action requests
   - connected service notifications
   - ready message preview

3. Payload
   - segmented control: Happier JSON, Custom JSON, Custom Text
   - template editor for custom formats
   - insert variable menu
   - rendered preview using a sample ready event

4. Delivery
   - success rule
   - signing mode

Advanced delivery fields should be collapsed by default. Payload format, preview, and test action should remain visible.

### Add Webhook Flow

Use a progressive flow:

1. Ask for URL and initial payload format.
2. Open the detail page for configuration and testing.

Saving should not require a successful test. If no test has succeeded, show `Untested`. If the last test failed, show `Failing` with diagnostics.

### Test Experience

Add a `Send Test` action on the detail page. The result should show:

- HTTP status
- whether success rules passed
- truncated response body
- specific failed rule

Example:

```text
HTTP 200 received, but success rule failed.
$.code expected 0, got 19002.
```

This prevents false confidence when a receiver returns HTTP 200 with a business error.

For version one, send-test should execute through the local daemon/CLI notification delivery path. The local path already has access to decrypted account settings and mirrors the runtime sender. The UI should request a test from the local session/machine context and render the returned diagnostics.

Cloud-side testing can be added later, but it should not be the first implementation because it would require a second secret-decryption and network-egress path. A cloud implementation would also risk diverging from the CLI sender unless both paths share the same delivery renderer and validator.

Changing the webhook URL, payload format, template, signing configuration, or success rule should reset the visible status to `Untested` until the user sends another test or a runtime delivery succeeds.

## Presets

Presets are optional convenience templates, not platform-specific code paths.

Initial presets can be generic:

- Happier activity JSON
- Generic JSON endpoint
- Chat bot text message
- Plain text endpoint

A future platform-named preset may exist, but it must only generate a generic delivery profile. The sender must not contain branches such as `if provider === 'feishu'`.

## Migration

Existing webhook channels require no migration. When `delivery` is absent, runtime behavior stays legacy-compatible.

When an existing webhook is opened in the UI, show:

- payload format: Happier JSON
- success: HTTP 2xx
- signing: Happier HMAC header if a signing secret exists

Only users who change payload format or success rules enter the new delivery profile path.

## First Version Scope

Include:

- optional delivery profile schema
- Happier JSON, Custom JSON, Custom Text
- deterministic template interpolation
- header/body rendering
- HMAC header signing
- HTTP status and JSON field success rules
- local daemon/CLI send-test diagnostics
- safety limits for headers, templates, rendered bodies, response diagnostics, and redaction
- webhook detail page
- rendered preview

Exclude:

- arbitrary JavaScript templates
- loops, conditionals, helper functions
- model-generated session summaries
- platform-specific sender branches
- HMAC body signing
- response body substring success rules
- cloud-side send-test execution
- full delivery history UI
- template marketplace or shared template library

## Testing Strategy

Protocol tests:

- legacy webhook channels parse unchanged
- delivery profile schema accepts valid configs
- invalid delivery configs are rejected
- secrets remain represented as `SecretStringV1`

CLI tests:

- legacy webhook sends the canonical Happier payload
- JSON template renders nested objects
- text template renders raw text
- headers can use template variables
- missing variables render as empty strings
- invalid header names are rejected
- rendered header values containing CR or LF are rejected
- oversized templates and rendered bodies are rejected
- HMAC header signing matches the legacy signature for legacy-compatible config
- HTTP 200 with failing JSON rule is not delivered
- HTTP 200 with matching JSON rule is delivered
- invalid JSON response fails when a JSON success rule is configured
- diagnostics truncate response bodies and redact sensitive data
- one failed webhook does not block other channels
- dedupe records only after at least one channel is delivered

UI tests:

- existing webhook rows summarize configuration
- detail page edits URL, enabled state, topics, payload format, template, success rule, and signing mode
- Custom JSON editor validates JSON
- rendered preview updates from the template
- changing URL, template, signing, or success rules resets status to `Untested`
- test result shows HTTP status, validation result, and response summary

## Open Questions

- Should webhook status store only the last test result locally, or sync a minimal status snapshot with account settings?
- Should future preset templates remain hard-coded in the client, or be fetched from the server so they can improve without an app release?
