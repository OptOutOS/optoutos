import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAdvancedBackgroundChecksResults } from "./advancedbackgroundchecks.js";

/**
 * Fixture is a real excerpt (not fabricated) saved from a live FlareSolverr
 * response for https://advancedbackgroundchecks.com/find/name/John-Smith on
 * 2026-09-09. See docs/FLARESOLVERR.md — the cookie-injection pattern that
 * works for /opt-out does not reliably work for /find/name/, so this parses
 * FlareSolverr's own returned HTML directly instead of trying to get
 * Playwright to reach the same page live.
 */
const fixtureHtml = readFileSync(
  join(__dirname, "__fixtures__", "advancedbackgroundchecks-search-results.html"),
  "utf-8",
);

describe("parseAdvancedBackgroundChecksResults", () => {
  it("extracts the primary result cards from real saved HTML", () => {
    const candidates = parseAdvancedBackgroundChecksResults(fixtureHtml);

    expect(candidates.length).toBeGreaterThan(0);
  });

  it("extracts a real John Smith candidate with name, age, city, state, and zip", () => {
    const candidates = parseAdvancedBackgroundChecksResults(fixtureHtml);
    const johnSmith = candidates.find((c) => c.candidateId.includes("john-smith-6Vg4aEq2xFaEf3"));

    expect(johnSmith).toBeDefined();
    expect(johnSmith?.observedName).toContain("John");
    expect(johnSmith?.observedName).toContain("Smith");
    expect(johnSmith?.observedCity).toBe("Port Orchard");
    expect(johnSmith?.observedState).toBe("WA");
    expect(johnSmith?.observedZip).toBe("98366");
    expect(johnSmith?.observedAgeRange).toBe("45");
  });

  it("captures a prior address ('used to live') as an extra field, never fabricating structure", () => {
    const candidates = parseAdvancedBackgroundChecksResults(fixtureHtml);
    const johnSmith = candidates.find((c) => c.candidateId.includes("john-smith-6Vg4aEq2xFaEf3"));

    expect(johnSmith?.extra?.usedToLive).toContain("Bremerton");
  });

  it("never returns a candidate without a candidateId (needed for the opt-out step)", () => {
    const candidates = parseAdvancedBackgroundChecksResults(fixtureHtml);

    for (const c of candidates) {
      expect(c.candidateId).toBeTruthy();
    }
  });

  it("returns an empty array for HTML with no result cards", () => {
    const candidates = parseAdvancedBackgroundChecksResults("<html><body>No results</body></html>");

    expect(candidates).toEqual([]);
  });
});
