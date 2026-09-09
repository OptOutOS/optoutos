import type { Page } from "playwright";
import type { PiiField, PiiProfile } from "../pii.js";
import type { SearchCandidate } from "./matching.js";

export type RemovalMethod = "api" | "form" | "email";

/**
 * Method preference order for a given broker, evaluated top to bottom.
 * Per project decision: prefer API (fastest, cleanest, no anti-bot fight)
 * > web form (may require anti-bot handling, e.g. Patchright) > email
 * (GDPR/CCPA-style formal request, works even against Turnstile-protected
 * sites since no page load is required, but is slower/less confirmable).
 *
 * If a broker's preferred method hits non-trivial anti-bot friction (e.g. an
 * interactive CAPTCHA/Turnstile challenge, not just a passive JS check), the
 * adapter should fail with status "requires_manual_verification" rather than
 * attempt to solve/bypass the challenge — see THREAT_MODEL.md and
 * ADAPTER_GUIDE.md "Anti-bot policy". Move on to the next method or broker
 * rather than sinking effort into defeating an active bot-detection widget.
 */
export const METHOD_PRIORITY: readonly RemovalMethod[] = ["api", "form", "email"];

export type RemovalStatus =
  | "submitted"
  | "already_absent"
  | "no_match_found"
  | "requires_manual_verification"
  | "failed";

export interface RemovalResult {
  broker: string;
  status: RemovalStatus;
  timestamp: string; // ISO 8601
  /** Non-PII evidence only: confirmation IDs, HTTP status, screenshot path (redacted). */
  evidence: Record<string, string | number | boolean>;
  error?: string;
}

/**
 * One adapter per broker. Adapters must:
 *  - request the minimum PII fields required (see requiredFields)
 *  - never write raw PII into RemovalResult.evidence or logs
 *  - fail closed: if the broker's page structure has changed in a way that
 *    prevents confident submission, return status "failed", not a guess.
 *
 * PRIVACY-MINIMIZATION RULE (non-negotiable — see matching.ts and engine.ts):
 * a broker must never receive an opt-out/removal request unless the user's
 * PII was first confirmed present via search(), scored locally against the
 * FULL profile using scoreCandidate(), and found to meet
 * MATCH_CONFIDENCE_THRESHOLD. search() itself must submit only
 * `searchFields` — a minimal subset of PII — never the full profile. Only
 * after a local match is confirmed does optOut() receive the fuller PII
 * needed to actually submit removal. Adapters must never call optOut()
 * directly from their own code as a shortcut around this gate — orchestration
 * lives in engine.ts (runRemoval()), which all callers (CLI, cloud) should
 * use instead of calling adapter methods directly.
 */
export interface BrokerAdapter {
  readonly brokerId: string;
  readonly brokerName: string;
  readonly method: RemovalMethod;
  readonly searchUrl: string;
  readonly optOutUrl: string;
  /** Full field set required to actually submit a removal request. */
  readonly requiredFields: readonly PiiField[];
  /**
   * Minimal field set sent on the initial search request — must be a subset
   * of requiredFields and should be as small as the broker's search
   * mechanism allows (e.g. name + city, not full street address).
   * Adapters without a public search mechanism (e.g. login-gated,
   * email-only) may omit this and must document why in their docstring.
   */
  readonly searchFields?: readonly PiiField[];

  /**
   * Search the broker using ONLY the fields in searchFields, and return the
   * broker's own publicly-displayed candidate records verbatim (redacted or
   * partial fields from the broker are fine — do not fabricate fields the
   * broker didn't actually show). Returns an empty array if no results.
   */
  search?(page: Page, minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]>;

  /**
   * Submit the opt-out/removal request for ONE confirmed-matching candidate.
   * Callers (engine.ts) only invoke this after scoreCandidate() has cleared
   * MATCH_CONFIDENCE_THRESHOLD for the given candidate — adapters may assume
   * that precondition holds when optOut() is called by the engine, but
   * should still not be called directly by adapter-external code without it.
   */
  optOut(
    page: Page,
    profile: Partial<PiiProfile>,
    candidate?: SearchCandidate,
  ): Promise<RemovalResult>;
}
