import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./server.js";
import type { Hono } from "hono";

/**
 * TDD for the web GUI's household-management endpoints (issue #13).
 *
 * Scope of this slice (local-file store only — BWS store selection for the
 * web GUI is a fast-follow, not blocking this slice): GET/POST /api/people
 * and GET /api/people/:id operate against a LocalEncryptedFileStore whose
 * path is configured via OPTOUTOS_WEB_STORE_PATH, using the passphrase
 * held by the unlock session from the previous slice (server.test.ts).
 *
 * Every household-mutating route requires an unlocked session first — see
 * "requires unlock" tests below. This is the same privacy-minimization
 * discipline as the rest of the project: never touch the encrypted store
 * without an explicit, session-scoped unlock.
 */
describe("household management routes", () => {
  let app: Hono;
  let storeDir: string;
  let storePath: string;
  const originalToken = process.env.BWS_ACCESS_TOKEN;
  const originalSecret = process.env.OPTOUTOS_BWS_SECRET_ID;
  const originalStorePath = process.env.OPTOUTOS_WEB_STORE_PATH;

  beforeEach(async () => {
    delete process.env.BWS_ACCESS_TOKEN;
    delete process.env.OPTOUTOS_BWS_SECRET_ID;
    storeDir = await mkdtemp(join(tmpdir(), "optoutos-web-test-"));
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

  async function unlock() {
    await app.request("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "test-pass-123" }),
    });
  }

  it("rejects GET /api/people with 423 Locked when the session is not unlocked", async () => {
    const res = await app.request("/api/people");
    expect(res.status).toBe(423);
  });

  it("rejects POST /api/people with 423 Locked when the session is not unlocked", async () => {
    const res = await app.request("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "John", lastName: "Smith" }),
    });
    expect(res.status).toBe(423);
  });

  it("creates and lists a person once unlocked", async () => {
    await unlock();

    const createRes = await app.request("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "John", lastName: "Smith", emails: ["john@example.com"] }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.firstName).toBe("John");
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const listRes = await app.request("/api/people");
    expect(listRes.status).toBe(200);
    const people = await listRes.json();
    expect(people).toHaveLength(1);
    expect(people[0].id).toBe(created.id);
  });

  it("gets a single person by id", async () => {
    await unlock();
    const createRes = await app.request("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Jane", lastName: "Doe" }),
    });
    const { id } = await createRes.json();

    const getRes = await app.request(`/api/people/${id}`);
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).firstName).toBe("Jane");
  });

  it("returns 404 for a nonexistent person id", async () => {
    await unlock();
    const res = await app.request("/api/people/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });

  it("edits an existing person via PATCH", async () => {
    await unlock();
    const createRes = await app.request("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "John", lastName: "Smith" }),
    });
    const { id } = await createRes.json();

    const patchRes = await app.request(`/api/people/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails: ["updated@example.com"] }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).emails).toEqual(["updated@example.com"]);
  });

  it("rejects creating a person missing required firstName/lastName with 400", async () => {
    await unlock();
    const res = await app.request("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "OnlyFirst" }),
    });
    expect(res.status).toBe(400);
  });

  it("persists people across requests within the unlocked session (real encrypted file round-trip)", async () => {
    await unlock();
    await app.request("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Persisted", lastName: "Person" }),
    });

    const listRes = await app.request("/api/people");
    const people = await listRes.json();
    expect(people.some((p: { firstName: string }) => p.firstName === "Persisted")).toBe(true);
  });
});
