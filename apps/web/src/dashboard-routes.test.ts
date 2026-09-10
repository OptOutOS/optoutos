import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./server.js";
import { listBrokerIds } from "@optoutos/core";
import type { Hono } from "hono";

/**
 * TDD for the read-only broker-status dashboard (issue #14).
 *
 * GET /api/people/:id/dashboard returns, for EVERY registered broker (not
 * just ones the person has ever been checked against), a row combining
 * that broker's static metadata (brokerId, brokerName) with whatever this
 * person's PersonRecord.brokerRunHistory says about it, or an explicit
 * "never checked" state if no run has happened yet. This is read-only:
 * no write actions, no live search/removal calls in this slice — see
 * server.ts's resolveHouseholdStore() gate, reused unchanged here.
 */
describe("GET /api/people/:id/dashboard", () => {
  let app: Hono;
  let storeDir: string;
  let storePath: string;
  const originalToken = process.env.BWS_ACCESS_TOKEN;
  const originalSecret = process.env.OPTOUTOS_BWS_SECRET_ID;
  const originalStorePath = process.env.OPTOUTOS_WEB_STORE_PATH;

  beforeEach(async () => {
    delete process.env.BWS_ACCESS_TOKEN;
    delete process.env.OPTOUTOS_BWS_SECRET_ID;
    storeDir = await mkdtemp(join(tmpdir(), "optoutos-web-dash-test-"));
    storePath = join(storeDir, "household.enc.json");
    process.env.OPTOUTOS_WEB_STORE_PATH = storePath;
    app = buildServer();
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
    if (originalToken === undefined) delete process.env.BWS_ACCESS_TOKEN;
    else process.env.BWS_ACCESS_TOKEN = originalToken;
    if (originalSecret === undefined) delete process.env.OPTOUTOS_BWS_SECRET_ID;
    else process.env.OPTOUTOS_BWS_SECRET_ID = originalSecret;
    if (originalStorePath === undefined) delete process.env.OPTOUTOS_WEB_STORE_PATH;
    else process.env.OPTOUTOS_WEB_STORE_PATH = originalStorePath;
  });

  async function unlockAndCreatePerson() {
    await app.request("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "test-pass-123", confirmPassphrase: "test-pass-123" }),
    });
    const res = await app.request("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "John", lastName: "Smith" }),
    });
    return (await res.json()).id as string;
  }

  it("rejects with 423 Locked when the session is not unlocked", async () => {
    const res = await app.request("/api/people/some-id/dashboard");
    expect(res.status).toBe(423);
  });

  it("returns 404 for a nonexistent person", async () => {
    await app.request("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "test-pass-123", confirmPassphrase: "test-pass-123" }),
    });
    const res = await app.request("/api/people/00000000-0000-4000-8000-000000000000/dashboard");
    expect(res.status).toBe(404);
  });

  it("returns one row per registered broker, all 'never checked' for a brand-new person", async () => {
    const id = await unlockAndCreatePerson();

    const res = await app.request(`/api/people/${id}/dashboard`);
    expect(res.status).toBe(200);
    const rows = await res.json();

    const allBrokerIds = listBrokerIds();
    expect(rows).toHaveLength(allBrokerIds.length);
    expect(rows.map((r: { brokerId: string }) => r.brokerId).sort()).toEqual(allBrokerIds);
    for (const row of rows) {
      expect(row.lastRunAt).toBeNull();
      expect(row.lastStatus).toBeNull();
      expect(typeof row.brokerName).toBe("string");
      expect(row.brokerName.length).toBeGreaterThan(0);
    }
  });

  it("reflects a real brokerRunHistory entry once one exists", async () => {
    const id = await unlockAndCreatePerson();

    // Simulate a run having happened by editing the person directly via
    // the existing PATCH route's underlying store -- but brokerRunHistory
    // isn't a PersonFieldsInput field, so we go through the real store
    // API the same way run-scheduled.ts does, using the same store path.
    const { LocalEncryptedFileStore } = await import("@optoutos/core");
    const store = new LocalEncryptedFileStore(storePath, "test-pass-123");
    const household = await store.load();
    const person = household.people.find((p) => p.id === id)!;
    person.brokerRunHistory["thatsthem"] = {
      lastRunAt: "2026-09-01T00:00:00.000Z",
      lastStatus: "requires_manual_verification",
    };
    await store.save(household);

    const res = await app.request(`/api/people/${id}/dashboard`);
    const rows = await res.json();
    const thatsthemRow = rows.find((r: { brokerId: string }) => r.brokerId === "thatsthem");

    expect(thatsthemRow.lastRunAt).toBe("2026-09-01T00:00:00.000Z");
    expect(thatsthemRow.lastStatus).toBe("requires_manual_verification");
  });
});
