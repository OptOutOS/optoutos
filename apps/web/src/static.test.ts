import { describe, it, expect } from "vitest";
import { buildServer } from "./server.js";

/**
 * TDD for static asset serving (the frontend, public/index.html + app.js +
 * app.css) via @hono/node-server/serve-static.
 *
 * SECURITY NOTE: this class of dependency has real CVE history — see
 * server.ts's module docstring for the specific advisories (Windows
 * backslash path traversal in Hono core, repeated-slash middleware bypass
 * and auth-bypass-via-inconsistent-decoding in @hono/node-server) and the
 * exact patched versions this project pins to. `npm audit` must report 0
 * vulnerabilities before this dependency is trusted (verified 2026-09-10).
 */
describe("static asset serving", () => {
  it("serves index.html at the root path", async () => {
    const app = buildServer();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("OptOutOS");
  });

  it("serves app.js with a JS content type", async () => {
    const app = buildServer();
    const res = await app.request("/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
  });

  it("does not allow path traversal outside the public directory", async () => {
    const app = buildServer();
    const res = await app.request("/../server.ts");
    expect(res.status).not.toBe(200);
  });

  it("api routes still take precedence over static serving (no route collision)", async () => {
    const app = buildServer();
    const res = await app.request("/api/unlock/status");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
