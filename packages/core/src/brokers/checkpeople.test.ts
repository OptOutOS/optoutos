import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkPeopleHasNoMatch, CheckPeopleAdapter } from "./checkpeople.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, "__fixtures__", name), "utf-8");
}

describe("checkPeopleHasNoMatch", () => {
  // REGRESSION TEST for a real bug found and fixed 2026-09-10: the first
  // implementation treated the #modifySearchModal "No results found" text
  // as a no-match signal. Direct comparison of a synthetic no-match
  // identity's fixture against a real common name's live response proved
  // that modal is present UNCONDITIONALLY -- it is not a match-count
  // signal at all. This function must never claim "no match" from that
  // markup again.

  it("returns false even on the synthetic no-match fixture (the modal is not a real signal)", () => {
    const html = loadFixture("checkpeople-no-match.html");
    expect(checkPeopleHasNoMatch(html)).toBe(false);
  });

  it("returns false for a real common-name response with the identical modal markup", () => {
    // Captured live 2026-09-10 against "John Smith" -- structurally
    // byte-for-byte identical to the synthetic no-match fixture aside
    // from the name itself. Proves the modal can't distinguish the two.
    const html = `
      <div class="results-container">
        <h1 class="results-headline-title">We found 10+ Results for <span>John Smith</span></h1>
      </div>
      <div class="modal" id="modifySearchModal">
        <h4 class="modal-title">No results found. Please refine your search</h4>
      </div>
    `;
    expect(checkPeopleHasNoMatch(html)).toBe(false);
  });

  it("returns false for empty or malformed HTML (fails closed, never throws)", () => {
    expect(() => checkPeopleHasNoMatch("")).not.toThrow();
    expect(checkPeopleHasNoMatch("")).toBe(false);
    expect(checkPeopleHasNoMatch("<html></html>")).toBe(false);
  });
});

describe("CheckPeopleAdapter.search", () => {
  it("returns [] when required name fields are missing", async () => {
    const adapter = new CheckPeopleAdapter();
    const result = await adapter.search(null as never, { firstName: "Only" });
    expect(result).toEqual([]);
  });

  // Live network behavior (real fetch() calls, no mocking) is verified
  // manually per this project's convention -- see
  // docs/BROKER_STATUS.md Round 11 for the live verification evidence.
  // This adapter always returns [] regardless of network outcome: no
  // reliable free-tier match signal exists (see checkPeopleHasNoMatch).
});
