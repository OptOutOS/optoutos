import { describe, it, expect } from "vitest";
import { scoreCandidate, MATCH_CONFIDENCE_THRESHOLD, pickPiiFields, DEFAULT_SEARCH_FIELDS } from "./index.js";
import type { PiiProfile } from "./pii.js";
import type { SearchCandidate } from "./brokers/matching.js";

/**
 * Regression tests for the privacy-minimization confidence gate.
 *
 * These lock in behavior that was manually verified live on 2026-09-09
 * (see docs/BROKER_STATUS.md "Privacy-minimization gate" section) before a
 * proper test suite existed. Treat any future change that breaks these as a
 * potential privacy regression, not just a test failure — this is the gate
 * standing between "confirmed match" and "send a stranger's PII to a
 * broker."
 */

const fullProfile: PiiProfile = {
  firstName: "John",
  lastName: "Smith",
  emails: ["john.smith@example.com"],
  phones: ["2065551234"],
  addresses: [{ street: "123 Main St", city: "Seattle", state: "WA", zip: "98101", country: "US" }],
  relatives: ["Jane Smith"],
};

describe("scoreCandidate", () => {
  it("scores a strong multi-field match at or near 1.0 and clears the threshold", () => {
    const candidate: SearchCandidate = {
      candidateId: "c1",
      observedName: "John Smith",
      observedCity: "Seattle",
      observedState: "WA",
      observedZip: "98101",
      observedPhone: "(206) 555-1234",
    };

    const result = scoreCandidate(candidate, fullProfile);

    expect(result.score).toBeCloseTo(1.0, 2);
    expect(result.score).toBeGreaterThanOrEqual(MATCH_CONFIDENCE_THRESHOLD);
    expect(result.matchedFields).toEqual(
      expect.arrayContaining(["name", "city", "state", "zip", "phone"]),
    );
  });

  it("blocks a same-last-name coincidental match in the wrong city (false-positive protection)", () => {
    const candidate: SearchCandidate = {
      candidateId: "c2",
      observedName: "Robert Smith",
      observedCity: "Miami",
      observedState: "FL",
    };

    const result = scoreCandidate(candidate, fullProfile);

    expect(result.score).toBeLessThan(MATCH_CONFIDENCE_THRESHOLD);
    expect(result.matchedFields).not.toContain("city");
    expect(result.matchedFields).not.toContain("state");
  });

  it("scores a complete non-match at 0", () => {
    const candidate: SearchCandidate = {
      candidateId: "c3",
      observedName: "Alice Johnson",
      observedCity: "Denver",
      observedState: "CO",
    };

    const result = scoreCandidate(candidate, fullProfile);

    expect(result.score).toBe(0);
    expect(result.matchedFields).toEqual([]);
  });

  it("does not penalize a sparse-but-consistent broker listing (score is normalized by available fields)", () => {
    const candidate: SearchCandidate = {
      candidateId: "c4",
      observedName: "John Smith",
      observedCity: "Seattle",
      observedState: "WA",
      // No phone/email/zip shown by this broker at all.
    };

    const result = scoreCandidate(candidate, fullProfile);

    expect(result.score).toBeCloseTo(1.0, 2);
    expect(result.score).toBeGreaterThanOrEqual(MATCH_CONFIDENCE_THRESHOLD);
  });

  it("returns a score of 0 when the candidate has no comparable fields at all", () => {
    const candidate: SearchCandidate = { candidateId: "c5" };

    const result = scoreCandidate(candidate, fullProfile);

    expect(result.score).toBe(0);
  });

  it("matches phone numbers regardless of formatting differences", () => {
    const candidate: SearchCandidate = {
      candidateId: "c6",
      observedPhone: "206.555.1234",
    };

    const result = scoreCandidate(candidate, fullProfile);

    expect(result.matchedFields).toContain("phone");
  });

  it("does not penalize a candidate merely for having observedRelatives when profile.relatives is empty (bug found 2026-09-09)", () => {
    const profileWithNoTrackedRelatives: PiiProfile = {
      ...fullProfile,
      relatives: [],
    };
    const candidateWithRelatives: SearchCandidate = {
      candidateId: "c7",
      observedName: "John Smith",
      observedCity: "Seattle",
      observedState: "WA",
      observedRelatives: ["Someone Unrelated"],
    };
    const candidateWithoutRelatives: SearchCandidate = {
      candidateId: "c8",
      observedName: "John Smith",
      observedCity: "Seattle",
      observedState: "WA",
    };

    const withRelatives = scoreCandidate(candidateWithRelatives, profileWithNoTrackedRelatives);
    const withoutRelatives = scoreCandidate(candidateWithoutRelatives, profileWithNoTrackedRelatives);

    // Merely having an observedRelatives list the profile can't confirm or
    // deny should be NEUTRAL, not a penalty — the broker showing a relative
    // we don't have on file is not evidence AGAINST a match.
    expect(withRelatives.score).toBeCloseTo(withoutRelatives.score, 5);
  });
});

describe("pickPiiFields", () => {
  it("returns only the requested fields, never the full profile", () => {
    const picked = pickPiiFields(fullProfile, DEFAULT_SEARCH_FIELDS);

    expect(picked).toHaveProperty("firstName", "John");
    expect(picked).toHaveProperty("lastName", "Smith");
    expect(picked).toHaveProperty("addresses");
    expect(picked).not.toHaveProperty("phones");
    expect(picked).not.toHaveProperty("emails");
  });

  it("omits fields the profile does not have", () => {
    const minimalProfile: PiiProfile = {
      firstName: "Jane",
      lastName: "Doe",
      emails: [],
      phones: [],
      addresses: [],
      relatives: [],
    };

    const picked = pickPiiFields(minimalProfile, ["firstName", "lastName", "dateOfBirth"]);

    expect(picked).toEqual({ firstName: "Jane", lastName: "Doe" });
  });
});
