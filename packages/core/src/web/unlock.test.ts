import { describe, it, expect, vi } from "vitest";
import { resolveUnlockSource, type UnlockSourceEnv } from "./unlock.js";

/**
 * TDD for the web GUI's household-store unlock resolution logic.
 *
 * POLICY (user decision, 2026-09-10): BWS-backed unlock is the PRIMARY
 * path (consistent with the user's standing preference for password-
 * manager workflows over typing raw passphrases), with an in-memory
 * passphrase prompt as the FALLBACK for users without Bitwarden
 * configured. This module only decides WHICH source is available and
 * usable — it does not itself prompt for anything or open a store; that
 * happens in the web server layer using whichever store the resolved
 * source indicates.
 */
describe("resolveUnlockSource", () => {
  it("prefers BWS when BWS_ACCESS_TOKEN and a secret id are both present", () => {
    const env: UnlockSourceEnv = {
      BWS_ACCESS_TOKEN: "token-value",
      OPTOUTOS_BWS_SECRET_ID: "secret-123",
    };
    expect(resolveUnlockSource(env)).toEqual({
      kind: "bws",
      secretId: "secret-123",
    });
  });

  it("falls back to a passphrase prompt when BWS_ACCESS_TOKEN is set but no secret id is configured", () => {
    const env: UnlockSourceEnv = { BWS_ACCESS_TOKEN: "token-value" };
    expect(resolveUnlockSource(env)).toEqual({ kind: "passphrase-prompt" });
  });

  it("falls back to a passphrase prompt when BWS_ACCESS_TOKEN is entirely unset", () => {
    const env: UnlockSourceEnv = { OPTOUTOS_BWS_SECRET_ID: "secret-123" };
    expect(resolveUnlockSource(env)).toEqual({ kind: "passphrase-prompt" });
  });

  it("falls back to a passphrase prompt when both are unset", () => {
    expect(resolveUnlockSource({})).toEqual({ kind: "passphrase-prompt" });
  });

  it("treats an empty-string token the same as unset (fails closed to the fallback, never a false BWS attempt)", () => {
    const env: UnlockSourceEnv = { BWS_ACCESS_TOKEN: "", OPTOUTOS_BWS_SECRET_ID: "secret-123" };
    expect(resolveUnlockSource(env)).toEqual({ kind: "passphrase-prompt" });
  });

  it("uses process.env by default when no env is passed", () => {
    const originalToken = process.env.BWS_ACCESS_TOKEN;
    const originalSecret = process.env.OPTOUTOS_BWS_SECRET_ID;
    try {
      process.env.BWS_ACCESS_TOKEN = "token-value";
      process.env.OPTOUTOS_BWS_SECRET_ID = "secret-abc";
      expect(resolveUnlockSource()).toEqual({ kind: "bws", secretId: "secret-abc" });
    } finally {
      if (originalToken === undefined) delete process.env.BWS_ACCESS_TOKEN;
      else process.env.BWS_ACCESS_TOKEN = originalToken;
      if (originalSecret === undefined) delete process.env.OPTOUTOS_BWS_SECRET_ID;
      else process.env.OPTOUTOS_BWS_SECRET_ID = originalSecret;
    }
  });
});

describe("InMemoryPassphraseSession (session lifecycle for the fallback path)", () => {
  it("holds a passphrase only in memory and clears it on lock()", async () => {
    const { InMemoryPassphraseSession } = await import("./unlock.js");
    const session = new InMemoryPassphraseSession();

    expect(session.hasPassphrase()).toBe(false);
    session.unlock("correct horse battery staple");
    expect(session.hasPassphrase()).toBe(true);
    expect(session.getPassphrase()).toBe("correct horse battery staple");

    session.lock();
    expect(session.hasPassphrase()).toBe(false);
    expect(() => session.getPassphrase()).toThrow();
  });

  it("never logs or exposes the passphrase via toString/JSON.stringify", async () => {
    const { InMemoryPassphraseSession } = await import("./unlock.js");
    const session = new InMemoryPassphraseSession();
    session.unlock("super-secret-value");

    expect(String(session)).not.toContain("super-secret-value");
    expect(JSON.stringify(session)).not.toContain("super-secret-value");
  });

  it("expires the passphrase after the configured idle timeout", async () => {
    vi.useFakeTimers();
    try {
      const { InMemoryPassphraseSession } = await import("./unlock.js");
      const session = new InMemoryPassphraseSession({ idleTimeoutMs: 1000 });
      session.unlock("value");
      expect(session.hasPassphrase()).toBe(true);

      vi.advanceTimersByTime(1001);
      expect(session.hasPassphrase()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
