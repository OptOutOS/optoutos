import { describe, it, expect } from "vitest";
import { scoreCandidateWithHousehold } from "./household-matching.js";
import type { SearchCandidate } from "../brokers/matching.js";
import type { Household, PersonRecord } from "./types.js";

describe("scoreCandidateWithHousehold", () => {
  const john: PersonRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    firstName: "John",
    lastName: "Smith",
    emails: [],
    phones: [],
    addresses: [{ street: "123 Main St", city: "Seattle", state: "WA", zip: "98101", country: "US" }],
  };
  const jane: PersonRecord = {
    id: "22222222-2222-4222-8222-222222222222",
    firstName: "Jane",
    lastName: "Smith",
    emails: [],
    phones: [],
    addresses: [],
  };
  const household: Household = {
    people: [john, jane],
    relationships: [{ personA: john.id, personB: jane.id, type: "spouse" }],
  };

  it("scores higher when the broker's observedRelatives includes a name from the linked household graph", () => {
    // Deliberately a PARTIAL match on its own (name matches, city doesn't) so
    // there's real headroom for the household-relative signal to move the
    // score — a candidate that's already 1.0 on visible fields can't be
    // boosted further, which would make this assertion vacuous.
    const candidateWithRelative: SearchCandidate = {
      candidateId: "c1",
      observedName: "John Smith",
      observedCity: "Portland", // does not match john's Seattle address
      observedRelatives: ["Jane Smith"],
    };
    const candidateWithoutRelative: SearchCandidate = {
      candidateId: "c2",
      observedName: "John Smith",
      observedCity: "Portland",
    };

    const withRelative = scoreCandidateWithHousehold(candidateWithRelative, john, household);
    const withoutRelative = scoreCandidateWithHousehold(candidateWithoutRelative, john, household);

    expect(withRelative.score).toBeGreaterThan(withoutRelative.score);
    expect(withRelative.matchedFields).toContain("household-relative");
  });

  it("does not boost score for a relative name that is NOT actually linked to this person in the graph", () => {
    const stranger: PersonRecord = {
      id: "33333333-3333-4333-8333-333333333333",
      firstName: "Bob",
      lastName: "Jones",
      emails: [],
      phones: [],
      addresses: [],
    };
    const householdWithStranger: Household = {
      people: [john, jane, stranger],
      relationships: [{ personA: john.id, personB: jane.id, type: "spouse" }],
      // Bob is in the household but NOT linked to john.
    };
    const candidate: SearchCandidate = {
      candidateId: "c1",
      observedName: "John Smith",
      observedRelatives: ["Bob Jones"],
    };

    const result = scoreCandidateWithHousehold(candidate, john, householdWithStranger);

    expect(result.matchedFields).not.toContain("household-relative");
  });

  it("falls back to normal scoreCandidate behavior when household has no relationships at all", () => {
    const soloHousehold: Household = { people: [john], relationships: [] };
    const candidate: SearchCandidate = { candidateId: "c1", observedName: "John Smith" };

    const result = scoreCandidateWithHousehold(candidate, john, soloHousehold);

    expect(result.score).toBeGreaterThan(0);
  });
});
