import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseUsPhonebookResults } from "./usphonebook.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(): string {
  return readFileSync(join(__dirname, "__fixtures__", "usphonebook-john-smith.html"), "utf-8");
}

describe("parseUsPhonebookResults", () => {
  it("parses real captured USPhonebook name-search HTML into candidates", () => {
    const html = loadFixture();
    const candidates = parseUsPhonebookResults(html);
    expect(candidates.length).toBeGreaterThan(3);
  });

  it("extracts name, age, city, state, and a profile-URL candidateId", () => {
    const html = loadFixture();
    const candidates = parseUsPhonebookResults(html);
    const match = candidates.find((c) => c.observedName?.includes("Johnathan"));
    expect(match).toBeDefined();
    expect(match?.observedName).toBe("Johnathan Ransom Smith");
    expect(match?.observedAgeRange).toBe("38");
    expect(match?.observedCity).toBe("Beulaville");
    expect(match?.observedState).toBe("NC");
    expect(match?.candidateId).toMatch(/^https:\/\/www\.usphonebook\.com\/johnathan-smith\//);
  });

  it("extracts observed relative names via itemprop=relatedTo, excluding the candidate's own name", () => {
    const html = loadFixture();
    const candidates = parseUsPhonebookResults(html);
    const match = candidates.find((c) => c.observedName?.includes("Johnathan"));
    expect(match?.observedRelatives).toBeDefined();
    expect(match?.observedRelatives).toContain("Keighley Smith");
    expect(match?.observedRelatives).not.toContain(match?.observedName);
  });

  it("returns an empty array for HTML with no result markup", () => {
    const candidates = parseUsPhonebookResults("<html><body>No results</body></html>");
    expect(candidates).toEqual([]);
  });

  it("does not throw on malformed/partial card markup", () => {
    const html = `<div class="success-wrapper-block" itemid="/x/y"><h3><span itemprop="name">Weird Name</span></h3></div>`;
    expect(() => parseUsPhonebookResults(html)).not.toThrow();
  });
});
