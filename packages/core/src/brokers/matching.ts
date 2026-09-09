import type { PiiField, PiiProfile } from "../pii.js";

/**
 * The minimal subset of PII sent on an initial search request — never the
 * full profile. Adapters declare which fields they need to search with via
 * BrokerAdapter.searchFields (a subset of, and always smaller than,
 * requiredFields used for the actual opt-out submission).
 *
 * Rule (non-negotiable, see engine.ts): a broker never receives PII beyond
 * what's needed to search until a local confidence check confirms a match
 * against a candidate record IT publicly returned.
 */
export type MinimalSearchProfile = Partial<PiiProfile>;

/**
 * One candidate record as scraped/observed directly from the broker's own
 * public search results — not fabricated, not inferred. Fields are whatever
 * the broker actually displayed (may be partial/redacted by the broker
 * itself, e.g. "John S***, Seattle, WA, age 30-39").
 */
export interface SearchCandidate {
  /** Opaque per-broker identifier for this listing (URL, internal ID, etc). */
  candidateId: string;
  /** Raw text fields as displayed by the broker, for local comparison only. */
  observedName?: string;
  observedCity?: string;
  observedState?: string;
  observedZip?: string;
  observedStreet?: string;
  observedPhone?: string;
  observedEmail?: string;
  observedAgeRange?: string;
  observedRelatives?: string[];
  /** Any other broker-specific fields useful for local comparison. */
  extra?: Record<string, string>;
}

export interface MatchScoreResult {
  candidate: SearchCandidate;
  score: number; // 0.0 - 1.0
  matchedFields: string[];
}

/**
 * Confidence threshold below which a candidate is not considered a match.
 * Chosen conservatively: false negatives (missing a real listing) are far
 * less harmful than false positives (submitting a stranger's PII, or
 * needlessly disclosing the user's fuller PII to a broker that doesn't
 * actually have their data).
 */
export const MATCH_CONFIDENCE_THRESHOLD = 0.6;

function normalize(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function digitsOnly(s: string | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/**
 * Score how well a broker's publicly-returned candidate record matches the
 * user's full local profile. Runs entirely locally — the full profile never
 * leaves the machine for this comparison.
 *
 * Weights are deliberately simple/explainable rather than ML-based: this is
 * a privacy-critical gate and must be auditable by inspection.
 */
export function scoreCandidate(
  candidate: SearchCandidate,
  fullProfile: PiiProfile,
): MatchScoreResult {
  const matchedFields: string[] = [];
  let score = 0;
  let totalWeight = 0;

  const weight = (available: boolean, w: number, matched: boolean) => {
    if (!available) return;
    totalWeight += w;
    if (matched) score += w;
  };

  const fullName = normalize(`${fullProfile.firstName}${fullProfile.lastName}`);
  const candName = normalize(candidate.observedName);
  weight(!!candidate.observedName, 0.3, !!fullName && candName.includes(normalize(fullProfile.lastName)));
  if (!!candidate.observedName && candName.includes(normalize(fullProfile.lastName))) {
    matchedFields.push("name");
  }

  const address = fullProfile.addresses?.[0];
  if (address) {
    const cityMatch = normalize(candidate.observedCity) === normalize(address.city);
    weight(!!candidate.observedCity, 0.2, cityMatch);
    if (cityMatch) matchedFields.push("city");

    const stateMatch = normalize(candidate.observedState) === normalize(address.state);
    weight(!!candidate.observedState, 0.15, stateMatch);
    if (stateMatch) matchedFields.push("state");

    const zipMatch = normalize(candidate.observedZip) === normalize(address.zip);
    weight(!!candidate.observedZip, 0.15, zipMatch);
    if (zipMatch) matchedFields.push("zip");

    const streetMatch =
      !!candidate.observedStreet &&
      normalize(candidate.observedStreet).startsWith(normalize(address.street).slice(0, 8));
    weight(!!candidate.observedStreet, 0.2, streetMatch);
    if (streetMatch) matchedFields.push("street");
  }

  if (candidate.observedPhone) {
    const phoneMatch = (fullProfile.phones ?? []).some(
      (p) => digitsOnly(p).slice(-10) === digitsOnly(candidate.observedPhone).slice(-10),
    );
    weight(true, 0.25, phoneMatch);
    if (phoneMatch) matchedFields.push("phone");
  }

  if (candidate.observedEmail) {
    const emailMatch = (fullProfile.emails ?? []).some(
      (e) => normalize(e) === normalize(candidate.observedEmail),
    );
    weight(true, 0.25, emailMatch);
    if (emailMatch) matchedFields.push("email");
  }

  if (candidate.observedRelatives?.length && (fullProfile.relatives ?? []).length > 0) {
    const relativeMatch = candidate.observedRelatives.some((r) =>
      (fullProfile.relatives ?? []).some((fr) => normalize(fr) === normalize(r)),
    );
    weight(true, 0.1, relativeMatch);
    if (relativeMatch) matchedFields.push("relatives");
  }

  const normalizedScore = totalWeight > 0 ? score / totalWeight : 0;
  return { candidate, score: normalizedScore, matchedFields };
}

/** Fields typically sufficient for an initial search — never the full profile. */
export const DEFAULT_SEARCH_FIELDS: readonly PiiField[] = ["firstName", "lastName", "addresses"];
