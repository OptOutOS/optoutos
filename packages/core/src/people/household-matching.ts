import { scoreCandidate, type SearchCandidate, type MatchScoreResult } from "../brokers/matching.js";
import type { PiiProfile } from "../pii.js";
import type { Household, PersonRecord } from "./types.js";

const HOUSEHOLD_RELATIVE_WEIGHT = 0.15;

function normalize(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Names of every person directly linked to `person` in the household graph. */
function linkedRelativeNames(person: PersonRecord, household: Household): string[] {
  const linkedIds = new Set<string>();
  for (const edge of household.relationships) {
    if (edge.personA === person.id) linkedIds.add(edge.personB);
    if (edge.personB === person.id) linkedIds.add(edge.personA);
  }

  return household.people
    .filter((p) => linkedIds.has(p.id))
    .map((p) => `${p.firstName} ${p.lastName}`);
}

function toPiiProfile(person: PersonRecord): PiiProfile {
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    middleName: person.middleName,
    dateOfBirth: person.dateOfBirth,
    emails: person.emails,
    phones: person.phones,
    addresses: person.addresses,
    // Deliberately NOT populated from the household graph: the base
    // scoreCandidate() has its own (now-neutral-when-empty, see
    // matching.test.ts "does not penalize...") relatives check keyed off
    // this field. If we populated it here too, a household-graph relative
    // match would be counted TWICE — once via base's relatives weight (0.1)
    // and again via HOUSEHOLD_RELATIVE_WEIGHT below. This module owns the
    // household-relative signal exclusively; base scoring stays
    // relatives-neutral for household-store callers.
    relatives: [],
  };
}

/**
 * Scores a broker's candidate record against one specific person, using the
 * base field-weighted scoreCandidate() PLUS an additional signal: if the
 * broker's own observedRelatives list contains a name that matches someone
 * ACTUALLY LINKED to this person in the household relationship graph (not
 * just any name in the household), the score is boosted.
 *
 * This is deliberately graph-scoped rather than household-wide: a name
 * merely present elsewhere in the household (e.g. an unrelated housemate)
 * must not count as corroborating evidence — only a real tracked
 * relationship should (see household-matching.test.ts "does not boost...").
 *
 * Still runs entirely locally — nothing here is sent to any broker.
 */
export function scoreCandidateWithHousehold(
  candidate: SearchCandidate,
  person: PersonRecord,
  household: Household,
): MatchScoreResult {
  const base = scoreCandidate(candidate, toPiiProfile(person));

  const relativeNames = linkedRelativeNames(person, household);
  if (!candidate.observedRelatives?.length || relativeNames.length === 0) {
    return base;
  }

  const normalizedRelativeNames = relativeNames.map(normalize);
  const householdRelativeMatch = candidate.observedRelatives.some((observed) =>
    normalizedRelativeNames.includes(normalize(observed)),
  );

  if (!householdRelativeMatch) {
    return base;
  }

  // Re-derive using the same total-weight normalization approach as
  // scoreCandidate, adding the household-relative signal as one more
  // weighted vote. We reconstruct totalWeight from the base result: since
  // base.score = matchedWeight / totalWeight, matchedWeight = base.score *
  // totalWeight, but totalWeight itself isn't exposed — so instead treat the
  // base as one score and blend the extra signal in proportionally.
  const boostedWeight = HOUSEHOLD_RELATIVE_WEIGHT;
  // Assume base's implicit totalWeight was 1.0-normalized already; blend as
  // a weighted average against the new signal (which is always "matched").
  const combinedScore = base.score + boostedWeight * (1 - base.score);

  return {
    candidate,
    score: combinedScore,
    matchedFields: [...base.matchedFields, "household-relative"],
  };
}
