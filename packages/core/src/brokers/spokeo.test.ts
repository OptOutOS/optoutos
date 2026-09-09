import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSpokeoResults } from "./spokeo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(): string {
  return readFileSync(join(__dirname, "__fixtures__", "spokeo-john-smith.html"), "utf-8");
}

describe("parseSpokeoResults", () => {
  it("parses real captured Spokeo search-result HTML into candidates", () => {
    const html = loadFixture();
    const candidates = parseSpokeoResults(html);
    expect(candidates.length).toBeGreaterThan(10);
  });

  it("extracts name, age, city, state, and a profile URL candidateId for the first candidate", () => {
    const html = loadFixture();
    const candidates = parseSpokeoResults(html);
    const first = candidates[0];
    expect(first.observedName).toContain("John");
    expect(first.observedName).toContain("Smith");
    expect(first.observedAgeRange).toMatch(/^\d+\+?$/);
    expect(first.observedCity).toBeTruthy();
    expect(first.observedState).toBeTruthy();
    expect(first.candidateId).toMatch(/^\/John-Smith\//);
  });

  it("extracts observed relative names when present", () => {
    const html = loadFixture();
    const candidates = parseSpokeoResults(html);
    const withRelatives = candidates.find((c) => c.observedRelatives && c.observedRelatives.length > 0);
    expect(withRelatives).toBeDefined();
    expect(withRelatives?.observedRelatives?.[0]).toBeTruthy();
  });

  it("does not include the candidate's own name in observedRelatives", () => {
    const html = loadFixture();
    const candidates = parseSpokeoResults(html);
    for (const c of candidates) {
      if (!c.observedRelatives) continue;
      expect(c.observedRelatives).not.toContain(c.observedName);
    }
  });

  it("uses a 2-letter state abbreviation, not the full state name from the profile URL", () => {
    const html = loadFixture();
    const candidates = parseSpokeoResults(html);
    const withState = candidates.filter((c) => c.observedState);
    expect(withState.length).toBeGreaterThan(0);
    for (const c of withState) {
      expect(c.observedState).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("returns an empty array for HTML with no result list", () => {
    const candidates = parseSpokeoResults("<html><body>No results</body></html>");
    expect(candidates).toEqual([]);
  });

  it("does not throw on malformed/partial listitem markup", () => {
    const html = `<div id="name-search-results-list"><div role="listitem"><h3><a href="/x">Weird Name</a></h3></div></div>`;
    expect(() => parseSpokeoResults(html)).not.toThrow();
  });
});
