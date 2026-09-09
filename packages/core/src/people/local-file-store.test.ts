import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalEncryptedFileStore } from "./local-file-store.js";
import type { PersonRecord } from "./types.js";

describe("LocalEncryptedFileStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "optoutos-people-test-"));
    filePath = join(dir, "household.enc.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const personA: PersonRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    firstName: "John",
    lastName: "Smith",
    emails: [],
    phones: [],
    addresses: [],
  };

  it("returns an empty household when the file does not exist yet", async () => {
    const store = new LocalEncryptedFileStore(filePath, "test-passphrase");

    const household = await store.load();

    expect(household.people).toEqual([]);
    expect(household.relationships).toEqual([]);
  });

  it("persists a household across separate store instances (same passphrase)", async () => {
    const store1 = new LocalEncryptedFileStore(filePath, "test-passphrase");
    await store1.save({ people: [personA], relationships: [] });

    const store2 = new LocalEncryptedFileStore(filePath, "test-passphrase");
    const loaded = await store2.load();

    expect(loaded.people).toEqual([personA]);
  });

  it("writes ciphertext on disk, not plaintext PII", async () => {
    const store = new LocalEncryptedFileStore(filePath, "test-passphrase");
    await store.save({ people: [personA], relationships: [] });

    const raw = await readFile(filePath, "utf-8");

    expect(raw).not.toContain("John");
    expect(raw).not.toContain("Smith");
  });

  it("throws when loading with the wrong passphrase", async () => {
    const store1 = new LocalEncryptedFileStore(filePath, "correct-passphrase");
    await store1.save({ people: [personA], relationships: [] });

    const store2 = new LocalEncryptedFileStore(filePath, "wrong-passphrase");

    await expect(store2.load()).rejects.toThrow();
  });

  it("rejects saving a household that fails schema validation", async () => {
    const store = new LocalEncryptedFileStore(filePath, "test-passphrase");

    await expect(
      store.save({
        people: [{ ...personA, id: "not-a-uuid" } as unknown as PersonRecord],
        relationships: [],
      }),
    ).rejects.toThrow();
  });
});
