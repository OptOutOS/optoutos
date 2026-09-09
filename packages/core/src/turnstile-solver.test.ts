import { describe, it, expect, vi, beforeEach } from "vitest";
import { TurnstileSolverClient, TurnstileSolverError, extractTurnstileSitekey } from "./turnstile-solver.js";

describe("extractTurnstileSitekey", () => {
  it("extracts a sitekey from a cf-turnstile div's data-sitekey attribute", () => {
    const html = `<html><body><div class="cf-turnstile" data-sitekey="0x4AAAAAAActoBfh_En8yr3T"></div></body></html>`;

    expect(extractTurnstileSitekey(html)).toBe("0x4AAAAAAActoBfh_En8yr3T");
  });

  it("extracts a sitekey regardless of attribute order", () => {
    const html = `<div data-sitekey="0xABC123" class="cf-turnstile" data-theme="light"></div>`;

    expect(extractTurnstileSitekey(html)).toBe("0xABC123");
  });

  it("returns undefined when no cf-turnstile sitekey is present", () => {
    const html = `<html><body><p>No challenge here</p></body></html>`;

    expect(extractTurnstileSitekey(html)).toBeUndefined();
  });
});

describe("TurnstileSolverClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  it("solves a Turnstile challenge and returns the token", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ token: "0.abc123longtoken", elapsed: 12.5 }),
    } as Response);

    const client = new TurnstileSolverClient("http://localhost:8191");
    const result = await client.solve("0x4AAAAAAActoBfh_En8yr3T", "https://example.com/optout");

    expect(result.token).toBe("0.abc123longtoken");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8191/solve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sitekey: "0x4AAAAAAActoBfh_En8yr3T",
          siteurl: "https://example.com/optout",
          timeout: 45,
        }),
      }),
    );
  });

  it("throws TurnstileSolverError when the service returns an error response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Turnstile token not obtained within 45s" }),
    } as Response);

    const client = new TurnstileSolverClient("http://localhost:8191");

    await expect(client.solve("0xkey", "https://example.com/")).rejects.toThrow(TurnstileSolverError);
  });

  it("throws TurnstileSolverError when fetch itself fails (service not running)", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

    const client = new TurnstileSolverClient("http://localhost:8191");

    await expect(client.solve("0xkey", "https://example.com/")).rejects.toThrow(TurnstileSolverError);
  });

  it("respects a custom timeout parameter", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ token: "0.tok", elapsed: 5 }),
    } as Response);

    const client = new TurnstileSolverClient("http://localhost:8191");
    await client.solve("0xkey", "https://example.com/", 90);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: expect.stringContaining('"timeout":90') }),
    );
  });
});

describe("getTurnstileSolverClientFromEnv", () => {
  it("returns undefined when TURNSTILE_SOLVER_URL is not set", async () => {
    delete process.env.TURNSTILE_SOLVER_URL;
    const { getTurnstileSolverClientFromEnv } = await import("./turnstile-solver.js");

    expect(getTurnstileSolverClientFromEnv()).toBeUndefined();
  });

  it("returns a client when TURNSTILE_SOLVER_URL is set", async () => {
    process.env.TURNSTILE_SOLVER_URL = "http://localhost:9000";
    const { getTurnstileSolverClientFromEnv } = await import("./turnstile-solver.js");

    const client = getTurnstileSolverClientFromEnv();
    expect(client).toBeInstanceOf(TurnstileSolverClient);
    delete process.env.TURNSTILE_SOLVER_URL;
  });
});
