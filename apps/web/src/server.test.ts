import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "./server.js";
import type { FastifyInstance } from "fastify";

/**
 * TDD for the web GUI's HTTP server.
 *
 * SECURITY POSTURE (see docs/DESIGN.md "Web GUI" decision and
 * THREAT_MODEL.md): this server binds to 127.0.0.1 ONLY (never 0.0.0.0),
 * matching the CLI's local-first trust model — the household store's
 * decrypted contents and any in-memory passphrase must never be reachable
 * from the network. Tests use Fastify's inject() (no real socket) so this
 * suite never needs a live port.
 */
describe("GET /api/unlock/status", () => {
  let app: FastifyInstance;
  const originalToken = process.env.BWS_ACCESS_TOKEN;
  const originalSecret = process.env.OPTOUTOS_BWS_SECRET_ID;

  afterEach(async () => {
    await app?.close();
    if (originalToken === undefined) delete process.env.BWS_ACCESS_TOKEN;
    else process.env.BWS_ACCESS_TOKEN = originalToken;
    if (originalSecret === undefined) delete process.env.OPTOUTOS_BWS_SECRET_ID;
    else process.env.OPTOUTOS_BWS_SECRET_ID = originalSecret;
  });

  it("reports the BWS unlock source and locked:true when BWS env vars are configured", async () => {
    process.env.BWS_ACCESS_TOKEN = "token-value";
    process.env.OPTOUTOS_BWS_SECRET_ID = "secret-123";
    app = buildServer();

    const res = await app.inject({ method: "GET", url: "/api/unlock/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ source: "bws", locked: true });
  });

  it("reports the passphrase-prompt fallback when BWS is not configured", async () => {
    delete process.env.BWS_ACCESS_TOKEN;
    delete process.env.OPTOUTOS_BWS_SECRET_ID;
    app = buildServer();

    const res = await app.inject({ method: "GET", url: "/api/unlock/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ source: "passphrase-prompt", locked: true });
  });
});

describe("POST /api/unlock (passphrase-prompt fallback path)", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    delete process.env.BWS_ACCESS_TOKEN;
    delete process.env.OPTOUTOS_BWS_SECRET_ID;
    app = buildServer();
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects an unlock attempt with no passphrase", async () => {
    const res = await app.inject({ method: "POST", url: "/api/unlock", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a passphrase and reports locked:false afterward, never echoing the passphrase back", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/unlock",
      payload: { passphrase: "correct horse battery staple" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain("correct horse battery staple");

    const status = await app.inject({ method: "GET", url: "/api/unlock/status" });
    expect(status.json()).toEqual({ source: "passphrase-prompt", locked: false });
  });

  it("rejects unlocking via BWS mode with a passphrase payload (wrong mode for this route in this config)", async () => {
    process.env.BWS_ACCESS_TOKEN = "token-value";
    process.env.OPTOUTOS_BWS_SECRET_ID = "secret-123";
    const bwsApp = buildServer();
    try {
      const res = await bwsApp.inject({
        method: "POST",
        url: "/api/unlock",
        payload: { passphrase: "whatever" },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await bwsApp.close();
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
    try {
      await app.inject({ method: "POST", url: "/api/unlock", payload: { passphrase: "x" } });
      let status = await app.inject({ method: "GET", url: "/api/unlock/status" });
      expect(status.json()).toMatchObject({ locked: false });

      const lockRes = await app.inject({ method: "POST", url: "/api/lock" });
      expect(lockRes.statusCode).toBe(200);

      status = await app.inject({ method: "GET", url: "/api/unlock/status" });
      expect(status.json()).toMatchObject({ locked: true });
    } finally {
      await app.close();
    }
  });
});
