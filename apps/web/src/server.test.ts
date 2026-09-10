import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "./server.js";
import type { Hono } from "hono";

/**
 * TDD for the web GUI's HTTP server (Hono).
 *
 * SECURITY POSTURE (see docs/DESIGN.md "Web GUI" decision and
 * THREAT_MODEL.md): this server binds to 127.0.0.1 ONLY (never 0.0.0.0),
 * matching the CLI's local-first trust model — the household store's
 * decrypted contents and any in-memory passphrase must never be reachable
 * from the network. Tests use Hono's app.request() (an in-process fetch,
 * no real socket) so this suite never needs a live port.
 */
describe("GET /api/unlock/status", () => {
  let app: Hono;
  const originalToken = process.env.BWS_ACCESS_TOKEN;
  const originalSecret = process.env.OPTOUTOS_BWS_SECRET_ID;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.BWS_ACCESS_TOKEN;
    else process.env.BWS_ACCESS_TOKEN = originalToken;
    if (originalSecret === undefined) delete process.env.OPTOUTOS_BWS_SECRET_ID;
    else process.env.OPTOUTOS_BWS_SECRET_ID = originalSecret;
  });

  it("reports the BWS unlock source and locked:true when BWS env vars are configured", async () => {
    process.env.BWS_ACCESS_TOKEN = "token-value";
    process.env.OPTOUTOS_BWS_SECRET_ID = "secret-123";
    app = buildServer();

    const res = await app.request("/api/unlock/status");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: "bws", locked: true });
  });

  it("reports the passphrase-prompt fallback when BWS is not configured", async () => {
    delete process.env.BWS_ACCESS_TOKEN;
    delete process.env.OPTOUTOS_BWS_SECRET_ID;
    app = buildServer();

    const res = await app.request("/api/unlock/status");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: "passphrase-prompt", locked: true });
  });
});

describe("POST /api/unlock (passphrase-prompt fallback path)", () => {
  let app: Hono;

  beforeEach(() => {
    delete process.env.BWS_ACCESS_TOKEN;
    delete process.env.OPTOUTOS_BWS_SECRET_ID;
    app = buildServer();
  });

  it("rejects an unlock attempt with no passphrase", async () => {
    const res = await app.request("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("accepts a passphrase and reports locked:false afterward, never echoing the passphrase back", async () => {
    const res = await app.request("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "correct horse battery staple" }),
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("correct horse battery staple");

    const status = await app.request("/api/unlock/status");
    expect(await status.json()).toEqual({ source: "passphrase-prompt", locked: false });
  });

  it("rejects unlocking via BWS mode with a passphrase payload (wrong mode for this route in this config)", async () => {
    process.env.BWS_ACCESS_TOKEN = "token-value";
    process.env.OPTOUTOS_BWS_SECRET_ID = "secret-123";
    const bwsApp = buildServer();
    try {
      const res = await bwsApp.request("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: "whatever" }),
      });
      expect(res.status).toBe(409);
    } finally {
      delete process.env.BWS_ACCESS_TOKEN;
      delete process.env.OPTOUTOS_BWS_SECRET_ID;
    }
  });
});

describe("POST /api/lock", () => {
  it("clears an unlocked session back to locked:true", async () => {
    delete process.env.BWS_ACCESS_TOKEN;
    delete process.env.OPTOUTOS_BWS_SECRET_ID;
    const app = buildServer();

    await app.request("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "x" }),
    });
    let status = await (await app.request("/api/unlock/status")).json();
    expect(status).toMatchObject({ locked: false });

    const lockRes = await app.request("/api/lock", { method: "POST" });
    expect(lockRes.status).toBe(200);

    status = await (await app.request("/api/unlock/status")).json();
    expect(status).toMatchObject({ locked: true });
  });
});
