import type { Page } from "playwright";
import type { PiiField, PiiProfile } from "../pii.js";

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
 */
export interface BrokerAdapter {
  readonly brokerId: string;
  readonly brokerName: string;
  readonly method: RemovalMethod;
  readonly searchUrl: string;
  readonly optOutUrl: string;
  readonly requiredFields: readonly PiiField[];

  /** Search the broker for a matching public record, if the broker supports it. */
  search?(page: Page, profile: Partial<PiiProfile>): Promise<boolean>;

  /** Submit the opt-out/removal request. */
  optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult>;
}
