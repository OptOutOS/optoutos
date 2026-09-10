import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkPeopleHasNoMatch } from "./checkpeople.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, "__fixtures__", name), "utf-8");
}

describe("checkPeopleHasNoMatch", () => {
  it("returns true for a real captured no-match results page", () => {
    // Real fixture captured live 2026-09-10 against a synthetic identity
    // ("Zaphod Beeblebrox", Fargo ND) that guarantees zero real matches —
    // see docs/checkpeople-reachability.md for the full navigation
    // sequence used to obtain it.
    const html = loadFixture("checkpeople-no-match.html");
    expect(checkPeopleHasNoMatch(html)).toBe(true);
  });

  it("does not treat the generic '10+ Results' marketing headline as a match signal", () => {
    // Verified live: CheckPeople's results page always renders "We found
    // 10+ Results for {name}" in the headline, even for a synthetic name
    // with zero real matches. The real empty-result signal is the
    // #modifySearchModal "No results found" text, present in the SAME
    // page load. A naive parser keying off the headline text would
    // incorrectly treat every response as a match.
    const html = `
      <div class="results-container">
        <h1 class="results-headline-title">We found 10+ Results for <span>Zaphod Beeblebrox</span></h1>
      </div>
      <div class="modal" id="modifySearchModal">
        <h4 class="modal-title">No results found. Please refine your search</h4>
      </div>
    `;
    expect(checkPeopleHasNoMatch(html)).toBe(true);
  });

  it("returns false when the no-match modal is absent (a real result set)", () => {
    const html = `
      <div class="results-container">
        <h1 class="results-headline-title">We found 10+ Results for <span>John Smith</span></h1>
      </div>
      <div class="result-card">Some Person, Age 40</div>
    `;
    expect(checkPeopleHasNoMatch(html)).toBe(false);
  });

  it("does not throw on empty or malformed HTML", () => {
    expect(() => checkPeopleHasNoMatch("")).not.toThrow();
    expect(checkPeopleHasNoMatch("<html></html>")).toBe(false);
  });
});
