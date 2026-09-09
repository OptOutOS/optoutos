import { describe, it, expect, vi, beforeEach } from "vitest";
import { BitwardenSecretsPeopleStore } from "./bws-store.js";
import type { PersonRecord } from "./types.js";

const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: mockExecFile }));

describe("BitwardenSecretsPeopleStore", () => {
  const secretId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const personA: PersonRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    firstName: "John",
    lastName: "Smith",
    emails: [],
    phones: [],
    addresses: [],
    brokerRunHistory: {},
  };

  beforeEach(() => {
    mockExecFile.mockReset();
    delete process.env.BWS_ACCESS_TOKEN;
  });

  it("throws if BWS_ACCESS_TOKEN is not set, without calling bws at all", async () => {
    const store = new BitwardenSecretsPeopleStore(secretId);

    await expect(store.load()).rejects.toThrow(/BWS_ACCESS_TOKEN/);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("loads and parses a household from the bws secret value", async () => {
    process.env.BWS_ACCESS_TOKEN = "test-token";
    const household = { people: [personA], relationships: [] };
    mockExecFile.mockImplementation((_cmd, _args, cb) => {
      cb(null, { stdout: JSON.stringify({ value: JSON.stringify(household) }), stderr: "" });
    });

    const store = new BitwardenSecretsPeopleStore(secretId);
    const loaded = await store.load();

    expect(loaded.people).toEqual([personA]);
  });

  it("returns an empty household if the secret doesn't exist yet (bws exits non-zero, not found)", async () => {
    process.env.BWS_ACCESS_TOKEN = "test-token";
    mockExecFile.mockImplementation((_cmd, _args, cb) => {
      cb(new Error("Secret not found"), { stdout: "", stderr: "not found" });
    });

    const store = new BitwardenSecretsPeopleStore(secretId);
    const loaded = await store.load();

    expect(loaded.people).toEqual([]);
  });

  it("calls 'bws secret edit' with the serialized household on save", async () => {
    process.env.BWS_ACCESS_TOKEN = "test-token";
    mockExecFile.mockImplementation((_cmd, _args, cb) => {
      cb(null, { stdout: "{}", stderr: "" });
    });

    const store = new BitwardenSecretsPeopleStore(secretId);
    await store.save({ people: [personA], relationships: [] });

    expect(mockExecFile).toHaveBeenCalledWith(
      "bws",
      expect.arrayContaining(["secret", "edit", secretId]),
      expect.any(Function),
    );
  });

  it("rejects saving a household that fails schema validation, without calling bws", async () => {
    process.env.BWS_ACCESS_TOKEN = "test-token";
    const store = new BitwardenSecretsPeopleStore(secretId);

    await expect(
      store.save({
        people: [{ ...personA, id: "not-a-uuid" } as unknown as PersonRecord],
        relationships: [],
      }),
    ).rejects.toThrow();
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
