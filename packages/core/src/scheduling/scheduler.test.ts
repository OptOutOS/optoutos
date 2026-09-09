import { describe, it, expect } from "vitest";
import { isDue, DEFAULT_RECHECK_INTERVAL_DAYS, getRecheckIntervalDays } from "./scheduler.js";
import type { PersonRecord } from "../people/types.js";

function makePerson(brokerRunHistory: PersonRecord["brokerRunHistory"] = {}): PersonRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    firstName: "John",
    lastName: "Smith",
    emails: [],
    phones: [],
    addresses: [],
    brokerRunHistory,
  };
}

describe("getRecheckIntervalDays", () => {
  it("returns the default interval for a broker with no override", () => {
    expect(getRecheckIntervalDays("some-unknown-broker")).toBe(DEFAULT_RECHECK_INTERVAL_DAYS);
  });

  it("returns a broker-specific override when one is configured", () => {
    // advancedbackgroundchecks is configured with a shorter interval than
    // default since it's proven fast/reliable to re-check (see scheduler.ts
    // BROKER_RECHECK_OVERRIDES_DAYS for rationale).
    const interval = getRecheckIntervalDays("advancedbackgroundchecks");
    expect(interval).toBeLessThanOrEqual(DEFAULT_RECHECK_INTERVAL_DAYS);
  });
});

describe("isDue", () => {
  const now = new Date("2026-09-09T00:00:00.000Z");

  it("is due when the broker has never been run for this person", () => {
    const person = makePerson();
    expect(isDue(person, "spokeo", now)).toBe(true);
  });

  it("is NOT due when the last run was recent (well within the interval)", () => {
    const person = makePerson({
      spokeo: { lastRunAt: "2026-09-08T00:00:00.000Z", lastStatus: "no_match_found" },
    });
    expect(isDue(person, "spokeo", now)).toBe(false);
  });

  it("is due when the last run is older than the broker's re-check interval", () => {
    const interval = getRecheckIntervalDays("spokeo");
    const longAgo = new Date(now.getTime() - (interval + 1) * 24 * 60 * 60 * 1000).toISOString();
    const person = makePerson({ spokeo: { lastRunAt: longAgo, lastStatus: "no_match_found" } });
    expect(isDue(person, "spokeo", now)).toBe(true);
  });

  it("is due exactly at the interval boundary is NOT yet due (interval must fully elapse)", () => {
    const interval = getRecheckIntervalDays("spokeo");
    const exactlyAtBoundary = new Date(now.getTime() - interval * 24 * 60 * 60 * 1000).toISOString();
    const person = makePerson({ spokeo: { lastRunAt: exactlyAtBoundary, lastStatus: "no_match_found" } });
    expect(isDue(person, "spokeo", now)).toBe(false);
  });

  it("treats each broker's due-ness independently for the same person", () => {
    const person = makePerson({
      spokeo: { lastRunAt: "2026-09-08T00:00:00.000Z", lastStatus: "no_match_found" },
      // usphonebook never run — due regardless of spokeo's recency.
    });
    expect(isDue(person, "spokeo", now)).toBe(false);
    expect(isDue(person, "usphonebook", now)).toBe(true);
  });

  it("is due again after a submitted removal once the interval elapses (brokers repopulate over time)", () => {
    const interval = getRecheckIntervalDays("advancedbackgroundchecks");
    const longAgo = new Date(now.getTime() - (interval + 1) * 24 * 60 * 60 * 1000).toISOString();
    const person = makePerson({
      advancedbackgroundchecks: { lastRunAt: longAgo, lastStatus: "submitted" },
    });
    expect(isDue(person, "advancedbackgroundchecks", now)).toBe(true);
  });
});
