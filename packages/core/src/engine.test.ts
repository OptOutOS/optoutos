import { describe, it, expect, vi } from "vitest";
import { runRemoval, readAllowPaywallBypassFromEnv } from "./index.js";
import type { BrokerAdapter, RemovalResult } from "./brokers/types.js";
import type { PiiProfile } from "./pii.js";
import type { SearchCandidate } from "./brokers/matching.js";
import type { Page } from "playwright";

/**
 * Regression tests for the mandatory privacy-minimization chokepoint.
 *
 * The single most important invariant in this codebase: optOut() must never
 * be called unless search() first returned a candidate that locally scores
 * above MATCH_CONFIDENCE_THRESHOLD against the full profile. These tests use
 * a fake Page (untyped stub — engine.ts never actually touches page methods
 * itself, only passes it through to the adapter) and spy on optOut() calls.
 */

const fullProfile: PiiProfile = {
  firstName: "John",
  lastName: "Smith",
  emails: ["john.smith@example.com"],
  phones: ["2065551234"],
  addresses: [{ street: "123 Main St", city: "Seattle", state: "WA", zip: "98101", country: "US" }],
  relatives: [],
};

const fakePage = {} as Page;

function makeAdapter(overrides: Partial<BrokerAdapter> = {}): BrokerAdapter {
  return {
    brokerId: "test-broker",
    brokerName: "Test Broker",
    method: "form",
    searchUrl: "https://example.com/search",
    optOutUrl: "https://example.com/optout",
    requiredFields: ["firstName", "lastName"],
    optOut: vi.fn(async (): Promise<RemovalResult> => ({
      broker: "test-broker",
      status: "submitted",
      timestamp: new Date().toISOString(),
      evidence: {},
    })),
    ...overrides,
  };
}

describe("runRemoval", () => {
  it("never calls optOut() when the adapter has no search() at all", async () => {
    const adapter = makeAdapter({ search: undefined });

    const result = await runRemoval(adapter, fakePage, fullProfile);

    expect(adapter.optOut).not.toHaveBeenCalled();
    expect(result.status).toBe("requires_manual_verification");
  });

  it("never calls optOut() when search() returns no candidates", async () => {
    const adapter = makeAdapter({
      search: vi.fn(async (): Promise<SearchCandidate[]> => []),
    });

    const result = await runRemoval(adapter, fakePage, fullProfile);

    expect(adapter.optOut).not.toHaveBeenCalled();
    expect(result.status).toBe("no_match_found");
  });

  it("never calls optOut() when the best candidate scores below the confidence threshold", async () => {
    const adapter = makeAdapter({
      search: vi.fn(async (): Promise<SearchCandidate[]> => [
        { candidateId: "weak", observedName: "Robert Smith", observedCity: "Miami", observedState: "FL" },
      ]),
    });

    const result = await runRemoval(adapter, fakePage, fullProfile);

    expect(adapter.optOut).not.toHaveBeenCalled();
    expect(result.status).toBe("no_match_found");
  });

  it("calls optOut() only with the confirmed candidate once the threshold is cleared", async () => {
    const strongCandidate: SearchCandidate = {
      candidateId: "strong",
      observedName: "John Smith",
      observedCity: "Seattle",
      observedState: "WA",
      observedZip: "98101",
    };
    const adapter = makeAdapter({
      search: vi.fn(async (): Promise<SearchCandidate[]> => [strongCandidate]),
    });

    const result = await runRemoval(adapter, fakePage, fullProfile);

    expect(adapter.optOut).toHaveBeenCalledTimes(1);
    expect(adapter.optOut).toHaveBeenCalledWith(fakePage, expect.any(Object), strongCandidate);
    expect(result.status).toBe("submitted");
  });

  it("only sends searchFields (not the full profile) to search()", async () => {
    const searchSpy = vi.fn(
      async (_page: Page, _minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]> => [],
    );
    const adapter = makeAdapter({
      searchFields: ["firstName", "lastName"],
      search: searchSpy,
    });

    await runRemoval(adapter, fakePage, fullProfile);

    const sentProfile = searchSpy.mock.calls[0][1];
    expect(sentProfile).toEqual({ firstName: "John", lastName: "Smith" });
    expect(sentProfile).not.toHaveProperty("phones");
    expect(sentProfile).not.toHaveProperty("emails");
    expect(sentProfile).not.toHaveProperty("addresses");
  });

  it("selects the best-scoring candidate when multiple are returned", async () => {
    const weakCandidate: SearchCandidate = {
      candidateId: "weak",
      observedName: "John Smithson",
      observedCity: "Portland",
      observedState: "OR",
    };
    const strongCandidate: SearchCandidate = {
      candidateId: "strong",
      observedName: "John Smith",
      observedCity: "Seattle",
      observedState: "WA",
      observedZip: "98101",
    };
    const adapter = makeAdapter({
      search: vi.fn(async (): Promise<SearchCandidate[]> => [weakCandidate, strongCandidate]),
    });

    const result = await runRemoval(adapter, fakePage, fullProfile);

    expect(adapter.optOut).toHaveBeenCalledWith(fakePage, expect.any(Object), strongCandidate);
    expect(result.status).toBe("submitted");
  });

  it("returns a failed status if search() itself throws, without calling optOut()", async () => {
    const adapter = makeAdapter({
      search: vi.fn(async () => {
        throw new Error("network error");
      }),
    });

    const result = await runRemoval(adapter, fakePage, fullProfile);

    expect(adapter.optOut).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error).toContain("network error");
  });

  it("never calls optOut() when dryRun:true is passed, even on a confirmed match", async () => {
    const strongCandidate: SearchCandidate = {
      candidateId: "strong",
      observedName: "John Smith",
      observedCity: "Seattle",
      observedState: "WA",
      observedZip: "98101",
    };
    const adapter = makeAdapter({
      search: vi.fn(async (): Promise<SearchCandidate[]> => [strongCandidate]),
    });

    const result = await runRemoval(adapter, fakePage, fullProfile, { dryRun: true });

    expect(adapter.optOut).not.toHaveBeenCalled();
    expect(result.status).toBe("dry_run_match_found");
    expect(result.matchDetails?.candidate).toEqual(strongCandidate);
  });

  it("calls optOut() as normal when dryRun is omitted (defaults to false)", async () => {
    const strongCandidate: SearchCandidate = {
      candidateId: "strong",
      observedName: "John Smith",
      observedCity: "Seattle",
      observedState: "WA",
      observedZip: "98101",
    };
    const adapter = makeAdapter({
      search: vi.fn(async (): Promise<SearchCandidate[]> => [strongCandidate]),
    });

    const result = await runRemoval(adapter, fakePage, fullProfile);

    expect(adapter.optOut).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("submitted");
  });

  it("dryRun:true still searches (read-only) and still surfaces no_match_found honestly", async () => {
    const adapter = makeAdapter({
      search: vi.fn(async (): Promise<SearchCandidate[]> => []),
    });

    const result = await runRemoval(adapter, fakePage, fullProfile, { dryRun: true });

    expect(adapter.search).toHaveBeenCalled();
    expect(adapter.optOut).not.toHaveBeenCalled();
    expect(result.status).toBe("no_match_found");
  });

  describe("allowPaywallBypass", () => {
    /**
     * Policy (user decision, 2026-09-10): OptOutOS never bypasses a genuine
     * payment paywall (as opposed to anti-bot/CAPTCHA, which IS fair game)
     * unless the user has explicitly opted in globally. Default is off.
     * See docs/DESIGN.md decision on paywall-bypass policy.
     *
     * This flag only controls whether the ENGINE permits an adapter's
     * paywall-bypass code path to run. It does NOT mean a working bypass
     * exists for any given broker — most brokers, including CheckPeople,
     * have no known free bypass technique at all; the flag being on
     * changes nothing for them (see checkpeople.ts, which does not
     * implement paywallSearch at all).
     */

    it("defaults to false: does not call an adapter's paywallSearch even if defined", async () => {
      const paywallSearchSpy = vi.fn(async (): Promise<SearchCandidate[]> => [
        { candidateId: "bypassed", observedName: "John Smith", observedCity: "Seattle", observedState: "WA" },
      ]);
      const adapter = makeAdapter({
        search: vi.fn(async (): Promise<SearchCandidate[]> => []),
        paywallSearch: paywallSearchSpy,
      });

      const result = await runRemoval(adapter, fakePage, fullProfile);

      expect(paywallSearchSpy).not.toHaveBeenCalled();
      expect(result.status).toBe("no_match_found");
    });

    it("does not call paywallSearch when allowPaywallBypass:true but the adapter has no paywallSearch", async () => {
      const adapter = makeAdapter({
        search: vi.fn(async (): Promise<SearchCandidate[]> => []),
      });

      const result = await runRemoval(adapter, fakePage, fullProfile, { allowPaywallBypass: true });

      expect(result.status).toBe("no_match_found");
    });

    it("calls paywallSearch only when allowPaywallBypass:true AND the adapter implements it, after search() finds nothing", async () => {
      const strongCandidate: SearchCandidate = {
        candidateId: "bypassed",
        observedName: "John Smith",
        observedCity: "Seattle",
        observedState: "WA",
        observedZip: "98101",
      };
      const searchSpy = vi.fn(async (): Promise<SearchCandidate[]> => []);
      const paywallSearchSpy = vi.fn(async (): Promise<SearchCandidate[]> => [strongCandidate]);
      const adapter = makeAdapter({
        search: searchSpy,
        paywallSearch: paywallSearchSpy,
      });

      const result = await runRemoval(adapter, fakePage, fullProfile, { allowPaywallBypass: true });

      expect(searchSpy).toHaveBeenCalled();
      expect(paywallSearchSpy).toHaveBeenCalledTimes(1);
      expect(adapter.optOut).toHaveBeenCalledWith(fakePage, expect.any(Object), strongCandidate);
      expect(result.status).toBe("submitted");
    });

    it("does not call paywallSearch if search() already found a confirmed match", async () => {
      const strongCandidate: SearchCandidate = {
        candidateId: "strong",
        observedName: "John Smith",
        observedCity: "Seattle",
        observedState: "WA",
        observedZip: "98101",
      };
      const paywallSearchSpy = vi.fn(async (): Promise<SearchCandidate[]> => []);
      const adapter = makeAdapter({
        search: vi.fn(async (): Promise<SearchCandidate[]> => [strongCandidate]),
        paywallSearch: paywallSearchSpy,
      });

      const result = await runRemoval(adapter, fakePage, fullProfile, { allowPaywallBypass: true });

      expect(paywallSearchSpy).not.toHaveBeenCalled();
      expect(result.status).toBe("submitted");
    });

    it("respects dryRun even when a paywall-bypassed candidate is found", async () => {
      const strongCandidate: SearchCandidate = {
        candidateId: "bypassed",
        observedName: "John Smith",
        observedCity: "Seattle",
        observedState: "WA",
        observedZip: "98101",
      };
      const adapter = makeAdapter({
        search: vi.fn(async (): Promise<SearchCandidate[]> => []),
        paywallSearch: vi.fn(async (): Promise<SearchCandidate[]> => [strongCandidate]),
      });

      const result = await runRemoval(adapter, fakePage, fullProfile, {
        allowPaywallBypass: true,
        dryRun: true,
      });

      expect(adapter.optOut).not.toHaveBeenCalled();
      expect(result.status).toBe("dry_run_match_found");
    });

    it("still fails closed to no_match_found if paywallSearch also returns nothing", async () => {
      const adapter = makeAdapter({
        search: vi.fn(async (): Promise<SearchCandidate[]> => []),
        paywallSearch: vi.fn(async (): Promise<SearchCandidate[]> => []),
      });

      const result = await runRemoval(adapter, fakePage, fullProfile, { allowPaywallBypass: true });

      expect(adapter.optOut).not.toHaveBeenCalled();
      expect(result.status).toBe("no_match_found");
    });
  });
});

describe("readAllowPaywallBypassFromEnv", () => {
  it("defaults to false when the env var is unset", () => {
    expect(readAllowPaywallBypassFromEnv({})).toBe(false);
  });

  it("returns false for any value other than '1' or 'true'", () => {
    expect(readAllowPaywallBypassFromEnv({ OPTOUTOS_ALLOW_PAYWALL_BYPASS: "0" })).toBe(false);
    expect(readAllowPaywallBypassFromEnv({ OPTOUTOS_ALLOW_PAYWALL_BYPASS: "false" })).toBe(false);
    expect(readAllowPaywallBypassFromEnv({ OPTOUTOS_ALLOW_PAYWALL_BYPASS: "yes" })).toBe(false);
    expect(readAllowPaywallBypassFromEnv({ OPTOUTOS_ALLOW_PAYWALL_BYPASS: "" })).toBe(false);
  });

  it("returns true for '1' or 'true' (case-insensitive, trimmed)", () => {
    expect(readAllowPaywallBypassFromEnv({ OPTOUTOS_ALLOW_PAYWALL_BYPASS: "1" })).toBe(true);
    expect(readAllowPaywallBypassFromEnv({ OPTOUTOS_ALLOW_PAYWALL_BYPASS: "true" })).toBe(true);
    expect(readAllowPaywallBypassFromEnv({ OPTOUTOS_ALLOW_PAYWALL_BYPASS: "TRUE" })).toBe(true);
    expect(readAllowPaywallBypassFromEnv({ OPTOUTOS_ALLOW_PAYWALL_BYPASS: "  true  " })).toBe(true);
  });
});
