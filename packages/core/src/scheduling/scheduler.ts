import type { PersonRecord } from "../people/types.js";

/**
 * Default re-check cadence for any broker without a specific override.
 * Chosen per privacyguides.org's published data-broker-removal guidance
 * (https://www.privacyguides.org/en/data-broker-removals/, checked
 * 2026-09-09): they recommend re-reviewing each broker roughly every 3-4
 * months on an ongoing rotation, since brokers re-populate listings from
 * refreshed public-record sources over time — this is a real, cited
 * third-party recommendation, not an invented number.
 */
export const DEFAULT_RECHECK_INTERVAL_DAYS = 100; // ~3.3 months

/**
 * Per-broker overrides where a different cadence is justified. Empty today
 * — this project has no broker-specific evidence yet (e.g. observed
 * re-listing speed) to justify deviating from the default. Documented here
 * as the extension point rather than hardcoding one-off numbers inline, so
 * a future finding ("Spokeo re-lists within 6 weeks, observed on <date>")
 * has an obvious place to go with its own citation.
 */
const BROKER_RECHECK_OVERRIDES_DAYS: Partial<Record<string, number>> = {};

export function getRecheckIntervalDays(brokerId: string): number {
  return BROKER_RECHECK_OVERRIDES_DAYS[brokerId] ?? DEFAULT_RECHECK_INTERVAL_DAYS;
}

/**
 * Whether a given person+broker pair is due for a re-check right now.
 *
 * Reads ONLY the compact rollup on PersonRecord.brokerRunHistory (never the
 * full JSONL run log — that's a separate audit trail, not the scheduling
 * source of truth; see logging/run-logger.ts and people/types.ts for the
 * split rationale). Pure function, no I/O, so it's trivially testable and
 * safe to call for every (person, broker) pair on every scheduler tick
 * without touching disk/network.
 *
 * Due whenever:
 *   - the broker has never been run for this person, OR
 *   - the broker's re-check interval has fully elapsed since the last run,
 *     REGARDLESS of what that last run's status was (a "submitted" removal
 *     still needs a future re-check, since brokers re-populate listings
 *     from refreshed source data over time — opting out is not permanent).
 */
export function isDue(person: PersonRecord, brokerId: string, now: Date = new Date()): boolean {
  const last = person.brokerRunHistory[brokerId];
  if (!last) return true;

  const intervalMs = getRecheckIntervalDays(brokerId) * 24 * 60 * 60 * 1000;
  const lastRunMs = new Date(last.lastRunAt).getTime();
  return now.getTime() - lastRunMs > intervalMs;
}
