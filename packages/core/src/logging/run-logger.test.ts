import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlRunLogger } from "./run-logger.js";
import type { RemovalResult } from "../brokers/types.js";

describe("JsonlRunLogger", () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "optoutos-log-test-"));
    logPath = join(dir, "runs.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const dummyResult: RemovalResult = {
    broker: "advancedbackgroundchecks",
    status: "no_match_found",
    timestamp: "2026-09-09T00:00:00.000Z",
    evidence: { candidatesReturned: 3, bestScore: 0.42 },
  };

  it("appends a JSON line per run with no PII fields", async () => {
    const logger = new JsonlRunLogger(logPath);
    await logger.record({ personId: "person-1", result: dummyResult });

    const raw = await readFile(logPath, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.broker).toBe("advancedbackgroundchecks");
    expect(entry.status).toBe("no_match_found");
    expect(entry.personId).toBe("person-1");
    expect(entry.timestamp).toBe("2026-09-09T00:00:00.000Z");
  });

  it("never persists raw name/email/address fields even if accidentally present in evidence", async () => {
    const logger = new JsonlRunLogger(logPath);
    const contaminated: RemovalResult = {
      ...dummyResult,
      // Simulates an adapter bug that leaked PII into evidence — the logger
      // must strip known PII-shaped keys defensively, not just trust callers.
      evidence: { ...dummyResult.evidence, email: "leak@example.com", firstName: "John" },
    };
    await logger.record({ personId: "person-1", result: contaminated });

    const raw = await readFile(logPath, "utf-8");
    expect(raw).not.toContain("leak@example.com");
    expect(raw).not.toContain("John");
  });

  it("appends multiple runs across calls without truncating prior entries", async () => {
    const logger = new JsonlRunLogger(logPath);
    await logger.record({ personId: "person-1", result: dummyResult });
    await logger.record({ personId: "person-1", result: { ...dummyResult, broker: "spokeo" } });

    const raw = await readFile(logPath, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("reads back all entries in order via readAll()", async () => {
    const logger = new JsonlRunLogger(logPath);
    await logger.record({ personId: "person-1", result: dummyResult });
    await logger.record({ personId: "person-1", result: { ...dummyResult, broker: "spokeo" } });

    const entries = await logger.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[0].broker).toBe("advancedbackgroundchecks");
    expect(entries[1].broker).toBe("spokeo");
  });

  it("readAll() returns an empty array when the log file does not exist yet", async () => {
    const logger = new JsonlRunLogger(join(dir, "does-not-exist.jsonl"));
    const entries = await logger.readAll();
    expect(entries).toEqual([]);
  });

  it("readLastRun() returns the most recent entry for a given person+broker pair", async () => {
    const logger = new JsonlRunLogger(logPath);
    await logger.record({ personId: "person-1", result: dummyResult });
    await logger.record({
      personId: "person-1",
      result: { ...dummyResult, timestamp: "2026-09-10T00:00:00.000Z" },
    });
    await logger.record({ personId: "person-2", result: dummyResult });

    const last = await logger.readLastRun("person-1", "advancedbackgroundchecks");
    expect(last?.timestamp).toBe("2026-09-10T00:00:00.000Z");
  });

  it("readLastRun() returns undefined when no matching run exists", async () => {
    const logger = new JsonlRunLogger(logPath);
    const last = await logger.readLastRun("nobody", "spokeo");
    expect(last).toBeUndefined();
  });
});
