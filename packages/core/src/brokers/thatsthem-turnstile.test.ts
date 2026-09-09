import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThatsThemAdapter } from "./thatsthem.js";

const solveTurnstileOnPageMock = vi.hoisted(() => vi.fn());
vi.mock("../turnstile-page-helper.js", () => ({
  solveTurnstileOnPage: solveTurnstileOnPageMock,
}));

function makeMockPage(hasTurnstile: boolean) {
  const filled: Record<string, string> = {};
  const locatorFor = (selector: string) => ({
    count: vi.fn(async () => {
      if (selector.includes("cf-turnstile")) return hasTurnstile ? 1 : 0;
      if (selector === "#name") return 1;
      return 0;
    }),
    fill: vi.fn(async (value: string) => {
      filled[selector] = value;
    }),
    selectOption: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
  });

  return {
    goto: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => locatorFor(selector)),
    waitForLoadState: vi.fn(async () => {}),
    url: vi.fn(() => "https://thatsthem.com/optout"),
    _filled: filled,
  };
}

const validProfile = {
  firstName: "John",
  lastName: "Smith",
  addresses: [{ street: "123 Main St", city: "Seattle", state: "WA", zip: "98101", country: "US" }],
  emails: ["john@example.com"],
  phones: ["2065551234"],
};

describe("ThatsThemAdapter.optOut — Turnstile solver integration", () => {
  beforeEach(() => {
    solveTurnstileOnPageMock.mockReset();
    delete process.env.TURNSTILE_SOLVER_URL;
  });

  afterEach(() => {
    delete process.env.TURNSTILE_SOLVER_URL;
  });

  it("falls back to requires_manual_verification when no solver is configured (unchanged behavior)", async () => {
    const adapter = new ThatsThemAdapter();
    const page = makeMockPage(true);

    const result = await adapter.optOut(page as never, validProfile);

    expect(result.status).toBe("requires_manual_verification");
    expect(result.evidence.reason).toContain("no TURNSTILE_SOLVER_URL configured");
    expect(solveTurnstileOnPageMock).not.toHaveBeenCalled();
  });

  it("attempts to solve via the configured solver and proceeds to fill the form on success", async () => {
    process.env.TURNSTILE_SOLVER_URL = "http://localhost:8191";
    solveTurnstileOnPageMock.mockResolvedValue({ token: "0.solved", elapsedSeconds: 8 });
    const adapter = new ThatsThemAdapter();
    const page = makeMockPage(true);

    const result = await adapter.optOut(page as never, validProfile);

    expect(solveTurnstileOnPageMock).toHaveBeenCalledTimes(1);
    // Falls through to the existing dry-run-mode path (still dryRun:true in
    // this file) rather than requires_manual_verification for Turnstile.
    expect(result.status).toBe("requires_manual_verification");
    expect(result.evidence.dryRun).toBe(true);
  });

  it("falls back to requires_manual_verification when the solver throws", async () => {
    process.env.TURNSTILE_SOLVER_URL = "http://localhost:8191";
    solveTurnstileOnPageMock.mockRejectedValue(new Error("solver timed out"));
    const adapter = new ThatsThemAdapter();
    const page = makeMockPage(true);

    const result = await adapter.optOut(page as never, validProfile);

    expect(result.status).toBe("requires_manual_verification");
    expect(result.evidence.reason).toContain("solver timed out");
  });

  it("skips the solver entirely when no Turnstile widget is present", async () => {
    process.env.TURNSTILE_SOLVER_URL = "http://localhost:8191";
    const adapter = new ThatsThemAdapter();
    const page = makeMockPage(false);

    await adapter.optOut(page as never, validProfile);

    expect(solveTurnstileOnPageMock).not.toHaveBeenCalled();
  });
});
