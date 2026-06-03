import type { Log } from "@sentry/core";

import { redactSensitiveKeys } from "@/utils/logging/redactSensitiveKeys";

export function redactSentryLogAttributes(attributes: Log["attributes"] | undefined): Log["attributes"] | undefined {
    if (!attributes) return attributes;
    const redacted = redactSensitiveKeys(attributes);
    return (redacted && typeof redacted === "object" ? (redacted as Log["attributes"]) : attributes);
}
