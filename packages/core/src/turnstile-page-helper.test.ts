import { describe, it, expect, vi } from "vitest";
import { solveTurnstileOnPage } from "./turnstile-page-helper.js";
import { TurnstileSolverClient } from "./turnstile-solver.js";

function makeMockPage(html: string) {
  const injectedTokens: string[] = [];
  return {
    content: vi.fn(async () => html),
    url: vi.fn(() => "https://example.com/optout"),
    evaluate: vi.fn(async (_fn: unknown, token: string) => {
      injectedTokens.push(token);
    }),
    _injectedTokens: injectedTokens,
  };
}

describe("solveTurnstileOnPage", () => {
  it("returns undefined (no-op) when the page has no cf-turnstile widget", async () => {
    const page = makeMockPage(`<html><body>No challenge</body></html>`);
    const solveSpy = vi.fn();
    const client = { solve: solveSpy } as unknown as TurnstileSolverClient;

    const result = await solveTurnstileOnPage(page as never, client);

    expect(result).toBeUndefined();
    expect(solveSpy).not.toHaveBeenCalled();
  });

  it("solves the widget and injects the token into the page when a sitekey is present", async () => {
    const html = `<div class="cf-turnstile" data-sitekey="0xABC123"></div>`;
    const page = makeMockPage(html);
    const solveSpy = vi.fn(async () => ({ token: "0.solvedtoken", elapsedSeconds: 10 }));
    const client = { solve: solveSpy } as unknown as TurnstileSolverClient;

    const result = await solveTurnstileOnPage(page as never, client);

    expect(result).toEqual({ token: "0.solvedtoken", elapsedSeconds: 10 });
    expect(solveSpy).toHaveBeenCalledWith("0xABC123", "https://example.com/optout", 45);
    expect(page._injectedTokens).toEqual(["0.solvedtoken"]);
  });

  it("propagates solver errors rather than swallowing them", async () => {
    const html = `<div class="cf-turnstile" data-sitekey="0xABC123"></div>`;
    const page = makeMockPage(html);
    const solveSpy = vi.fn(async () => {
      throw new Error("solver unreachable");
    });
    const client = { solve: solveSpy } as unknown as TurnstileSolverClient;

    await expect(solveTurnstileOnPage(page as never, client)).rejects.toThrow("solver unreachable");
  });
});
