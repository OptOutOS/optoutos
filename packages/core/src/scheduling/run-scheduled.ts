import type { Page } from "playwright";
import type { PeopleStore } from "../people/store.js";
import type { PersonRecord } from "../people/types.js";
import type { BrokerAdapter } from "../brokers/types.js";
import { runRemoval } from "../brokers/engine.js";
import { isDue } from "./scheduler.js";
import { JsonlRunLogger } from "../logging/run-logger.js";

/** Household-matching.ts uses the same shape; kept in sync deliberately. */
function personToPiiProfile(person: PersonRecord) {
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    middleName: person.middleName,
    dateOfBirth: person.dateOfBirth,
    emails: person.emails,
    phones: person.phones,
    addresses: person.addresses,
    relatives: [],
  };
}

export interface RunScheduledChecksOptions {
  store: PeopleStore;
  adapters: BrokerAdapter[];
  page: Page;
  /** Same meaning as RunRemovalOptions.dryRun — passed straight through. */
  dryRun: boolean;
  /** Injectable clock for deterministic tests; defaults to the real time. */
  now?: Date;
  /**
   * Optional run-log sink. When omitted, results are still applied to
   * PersonRecord.brokerRunHistory and persisted via store.save(), but no
   * JSONL audit entry is written — callers that want the debug/audit trail
   * (see logging/run-logger.ts) should pass one pointed at a per-household
   * log file.
   */
  logger?: JsonlRunLogger;
}

export interface RunScheduledChecksSummary {
  ranCount: number;
  skippedCount: number;
  errorCount: number;
}

/**
 * Iterate every (person, adapter) pair in the household, run runRemoval()
 * for every pair that isDue() says is due, update each person's
 * brokerRunHistory rollup, persist the household once at the end, and
 * (if a logger is provided) append a non-PII audit entry per run.
 *
 * This is the function a scheduled job (cron/Task Scheduler invoking the
 * CLI, or a future daemon) calls on a recurring cadence — see
 * docs/SCHEDULING.md for the recommended cadence and setup. It deliberately
 * does NOT decide the cadence itself beyond consulting isDue() — the
 * caller's job scheduler decides how OFTEN this function is invoked (e.g.
 * daily), and isDue() decides which pairs actually need work on a given
 * invocation, so running this daily is safe and just becomes a no-op for
 * everything not yet due.
 *
 * A failure in one (person, broker) pair (network error, adapter throwing,
 * etc.) does not stop the rest — see the "continues running remaining
 * pairs even when one adapter throws" test. Each pair's own error, if any,
 * is captured in that pair's logged/rolled-up outcome, not swallowed
 * silently and not allowed to abort the whole run.
 */
export async function runScheduledChecks(
  options: RunScheduledChecksOptions,
): Promise<RunScheduledChecksSummary> {
  const { store, adapters, page, dryRun, logger } = options;
  const now = options.now ?? new Date();

  const household = await store.load();
  let ranCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const person of household.people) {
    for (const adapter of adapters) {
      if (!isDue(person, adapter.brokerId, now)) {
        skippedCount++;
        continue;
      }

      ranCount++;
      const profile = personToPiiProfile(person);

      try {
        const result = await runRemoval(adapter, page, profile, { dryRun });

        if (result.status === "failed") {
          errorCount++;
        }

        person.brokerRunHistory[adapter.brokerId] = {
          lastRunAt: result.timestamp,
          lastStatus: result.status,
        };

        if (logger) {
          await logger.record({ personId: person.id, result });
        }
      } catch (err) {
        // Defense in depth: runRemoval() itself already catches
        // search()/optOut() throwing and returns a "failed" RemovalResult
        // (see engine.ts) — this branch only fires for a genuinely
        // unexpected failure outside that contract (e.g. a bug in this
        // function itself), and must still not abort the remaining pairs.
        errorCount++;
        const timestamp = new Date().toISOString();
        person.brokerRunHistory[adapter.brokerId] = {
          lastRunAt: timestamp,
          lastStatus: "failed",
        };

        if (logger) {
          await logger.record({
            personId: person.id,
            result: {
              broker: adapter.brokerId,
              status: "failed",
              timestamp,
              evidence: {},
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    }
  }

  await store.save(household);

  return { ranCount, skippedCount, errorCount };
}
