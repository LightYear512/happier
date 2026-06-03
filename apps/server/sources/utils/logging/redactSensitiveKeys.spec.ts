import { describe, expect, it } from "vitest";

import { redactSensitiveKeys } from "./redactSensitiveKeys";

describe("utils/logging/redactSensitiveKeys", () => {
    it("redacts common secret keys recursively", () => {
        const input = {
            authorization: "Bearer abc",
            cookie: "a=b",
            nested: {
                token: "t1",
                password: "p1",
                apiKey: "k1",
                api_key: "k2",
                ok: "keep",
            },
            arr: [{ secret: "s1" }, { value: 1 }],
        };

        expect(redactSensitiveKeys(input)).toEqual({
            authorization: "[redacted]",
            cookie: "[redacted]",
            nested: {
                token: "[redacted]",
                password: "[redacted]",
                apiKey: "[redacted]",
                api_key: "[redacted]",
                ok: "keep",
            },
            arr: [{ secret: "[redacted]" }, { value: 1 }],
        });
    });

    it("only matches by key name, not by value or message text", () => {
        const input = { msg: "token=abc leaked", auth: "Bearer xyz" };
        // `msg` and `auth` are not in the sensitive-key set, so they pass through.
        expect(redactSensitiveKeys(input)).toEqual(input);
    });

    it("leaves non-objects unchanged", () => {
        expect(redactSensitiveKeys(undefined)).toBeUndefined();
        expect(redactSensitiveKeys("plain")).toBe("plain");
        expect(redactSensitiveKeys(42)).toBe(42);
        expect(redactSensitiveKeys({})).toEqual({});
    });

    it("does not mutate the input object", () => {
        const input = { token: "t1", ok: "keep" };
        redactSensitiveKeys(input);
        expect(input.token).toBe("t1");
    });

    it("returns the same reference when there is nothing to redact (no allocation on hot path)", () => {
        const clean = { a: 1, nested: { b: 2, arr: [{ c: 3 }] } };
        // Identity, not just equality: unchanged subtrees must not be cloned.
        expect(redactSensitiveKeys(clean)).toBe(clean);
        expect(redactSensitiveKeys(clean).nested).toBe(clean.nested);
    });

    it("clones only on the path that changed, leaving untouched subtrees by reference", () => {
        const sharedClean = { deep: { x: 1 } };
        const input = { token: "t1", keep: sharedClean };
        const out = redactSensitiveKeys(input);
        expect(out).not.toBe(input); // changed → new top-level object
        expect(out.token).toBe("[redacted]");
        expect(out.keep).toBe(sharedClean); // untouched subtree shared by reference
    });
});
