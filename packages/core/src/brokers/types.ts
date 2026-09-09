import type { Page } from "playwright";
import type { PiiField, PiiProfile } from "../pii.js";

export type RemovalMethod = "form" | "email" | "api";

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
