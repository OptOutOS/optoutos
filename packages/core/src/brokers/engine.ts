import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import {
  MATCH_CONFIDENCE_THRESHOLD,
  scoreCandidate,
  type SearchCandidate,
  type MatchScoreResult,
} from "./matching.js";

/**
 * The single required entry point for running a removal against a broker.
 *
 * PRIVACY-MINIMIZATION RULE (see types.ts docstring on BrokerAdapter):
 * a removal request must NEVER be sent unless the user's PII was confirmed
 * present via search() first. Concretely, this function:
 *
 *   1. Calls adapter.search() with ONLY the minimal field subset
 *      (adapter.searchFields ?? DEFAULT_SEARCH_FIELDS) — never the full
 *      profile — to get the broker's own publicly-displayed candidates.
 *   2. Scores every returned candidate LOCALLY against the full profile
 *      (scoreCandidate) — the full profile is never sent to the broker at
 *      this stage, only compared on-device.
 *   3. Only if at least one candidate clears MATCH_CONFIDENCE_THRESHOLD does
 *      it proceed to adapter.optOut() for that specific matched candidate,
 *      now allowed to use the fuller `requiredFields` needed to submit.
 *   4. If no candidate matches, or the adapter has no search() capability at
 *      all, this returns status "no_match_found" / "requires_manual_verification"
 *      respectively — it does NOT fall back to submitting opt-out blind.
 *
 * Adapters without a search() method (login-gated, no public search UI) are
 * a deliberate exception: they cannot be confidence-gated this way, and must
 * be explicit about that in their docstring (see intelius.ts, radaris.ts).
 * runRemoval() surfaces this as "requires_manual_verification" rather than
 * silently skipping the gate — a human must confirm identity out of band.
 */
export async function runRemoval(
  adapter: BrokerAdapter,
  page: Page,
  fullProfile: PiiProfile,
): Promise<RemovalResult & { matchDetails?: MatchScoreResult }> {
  const timestamp = new Date().toISOString();

  if (!adapter.search) {
    return {
      broker: adapter.brokerId,
      status: "requires_manual_verification",
      timestamp,
      evidence: {
        reason:
          "This broker has no automatable public search — cannot confirm a match before opting out without human-in-the-loop identity verification. See adapter docstring.",
      },
    };
  }

  const { pickPiiFields } = await import("../pii.js");
  const { DEFAULT_SEARCH_FIELDS } = await import("./matching.js");
  const searchFields = adapter.searchFields ?? DEFAULT_SEARCH_FIELDS;
  const minimalProfile = pickPiiFields(fullProfile, searchFields);

  let candidates: SearchCandidate[];
  try {
    candidates = await adapter.search(page, minimalProfile);
  } catch (err) {
    return {
      broker: adapter.brokerId,
      status: "failed",
      timestamp,
      evidence: {},
      error: `search() failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (candidates.length === 0) {
    return {
      broker: adapter.brokerId,
      status: "no_match_found",
      timestamp,
      evidence: { candidatesReturned: 0 },
    };
  }

  const scored = candidates
    .map((c) => scoreCandidate(c, fullProfile))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (best.score < MATCH_CONFIDENCE_THRESHOLD) {
    return {
      broker: adapter.brokerId,
      status: "no_match_found",
      timestamp,
      evidence: {
        candidatesReturned: candidates.length,
        bestScore: Math.round(best.score * 100) / 100,
        threshold: MATCH_CONFIDENCE_THRESHOLD,
      },
      matchDetails: best,
    };
  }

  // Only now — after a locally-confirmed match — do we let the adapter send
  // the fuller PII needed to actually submit removal.
  const removalFields = adapter.requiredFields;
  const removalProfile = (await import("../pii.js")).pickPiiFields(fullProfile, removalFields);

  const result = await adapter.optOut(page, removalProfile, best.candidate);
  return { ...result, matchDetails: best };
}
