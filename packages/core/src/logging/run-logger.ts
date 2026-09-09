import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RemovalResult } from "../brokers/types.js";

/**
 * A single logged run outcome — status, evidence, timing, and non-PII
 * identifiers only. This is the durable record a scheduler (see
 * scheduling/scheduler.ts) reads to decide what's "due" for re-checking,
 * and what a user reviews to see what happened without re-running anything.
 *
 * PRIVACY RULE (non-negotiable, matches BrokerAdapter's contract in
 * types.ts): logs must NEVER contain a person's name, email, phone,
 * address, or any other raw PII — only broker id, person id (an opaque
 * store-generated UUID, not a name), status, timestamp, and the adapter's
 * own `evidence` object (which itself must already be non-PII per
 * RemovalResult's contract — see types.ts). This logger also defensively
 * strips a fixed list of PII-shaped key names from evidence before writing,
 * in case an adapter has a bug and leaks something it shouldn't — logging
 * is the last line of defense here, not the only one.
 */
export interface RunLogEntry {
  personId: string;
  broker: string;
  status: RemovalResult["status"];
  timestamp: string;
  evidence: Record<string, string | number | boolean>;
  error?: string;
}

export interface RecordRunInput {
  personId: string;
  result: RemovalResult;
}

/**
 * Key names defensively stripped from `evidence` before writing, even
 * though adapters are contractually required to keep RemovalResult.evidence
 * non-PII already (see BrokerAdapter docstring in brokers/types.ts). This
 * is a safety net for adapter bugs, not the primary enforcement mechanism.
 */
const PII_SHAPED_EVIDENCE_KEYS = new Set([
  "email",
  "emails",
  "phone",
  "phones",
  "firstName",
  "lastName",
  "middleName",
  "street",
  "address",
  "addresses",
  "dateOfBirth",
]);

function sanitizeEvidence(
  evidence: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (PII_SHAPED_EVIDENCE_KEYS.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Append-only, newline-delimited JSON (JSONL) run log. One file per
 * household/store is the expected usage (mirrors the "physical isolation
 * per household" principle already used for PeopleStore) — never a single
 * shared log across unrelated households.
 */
export class JsonlRunLogger {
  constructor(private readonly path: string) {}

  async record(input: RecordRunInput): Promise<void> {
    const entry: RunLogEntry = {
      personId: input.personId,
      broker: input.result.broker,
      status: input.result.status,
      timestamp: input.result.timestamp,
      evidence: sanitizeEvidence(input.result.evidence),
      ...(input.result.error ? { error: input.result.error } : {}),
    };

    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf-8");
  }

  async readAll(): Promise<RunLogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as RunLogEntry);
  }

  /**
   * The most recent logged run for a given person+broker pair, or undefined
   * if none exists yet. Used by the scheduler to decide whether a re-check
   * is due (see scheduling/scheduler.ts isDue()).
   */
  async readLastRun(personId: string, broker: string): Promise<RunLogEntry | undefined> {
    const entries = await this.readAll();
    let last: RunLogEntry | undefined;
    for (const entry of entries) {
      if (entry.personId !== personId || entry.broker !== broker) continue;
      if (!last || entry.timestamp > last.timestamp) last = entry;
    }
    return last;
  }
}
