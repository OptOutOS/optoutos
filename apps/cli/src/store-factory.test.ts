import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveStore } from "./store-factory.js";
import { LocalEncryptedFileStore, BitwardenSecretsPeopleStore } from "@optoutos/core";

describe("resolveStore", () => {
  const originalPassphrase = process.env.OPTOUTOS_PASSPHRASE;
  const originalToken = process.env.BWS_ACCESS_TOKEN;

  beforeEach(() => {
    delete process.env.OPTOUTOS_PASSPHRASE;
    delete process.env.BWS_ACCESS_TOKEN;
  });

  afterEach(() => {
    if (originalPassphrase === undefined) delete process.env.OPTOUTOS_PASSPHRASE;
    else process.env.OPTOUTOS_PASSPHRASE = originalPassphrase;
    if (originalToken === undefined) delete process.env.BWS_ACCESS_TOKEN;
    else process.env.BWS_ACCESS_TOKEN = originalToken;
  });

  it("builds a LocalEncryptedFileStore for a local-file selector, reading the passphrase from env", () => {
    process.env.OPTOUTOS_PASSPHRASE = "correct horse battery staple";

    const store = resolveStore({ kind: "local-file", path: "./household.enc.json" });

    expect(store).toBeInstanceOf(LocalEncryptedFileStore);
  });

  it("throws a clear error for a local-file selector when OPTOUTOS_PASSPHRASE is not set", () => {
    expect(() => resolveStore({ kind: "local-file", path: "./household.enc.json" })).toThrow(
      /OPTOUTOS_PASSPHRASE/,
    );
  });

  it("builds a BitwardenSecretsPeopleStore for a bws selector", () => {
    process.env.BWS_ACCESS_TOKEN = "test-token";

    const store = resolveStore({ kind: "bws", secretId: "some-secret-id" });

    expect(store).toBeInstanceOf(BitwardenSecretsPeopleStore);
  });

  // Note: BWS_ACCESS_TOKEN presence is validated by BitwardenSecretsPeopleStore
  // itself at load()/save() time (existing convention) — resolveStore does
  // not duplicate that check for the bws case.
});
