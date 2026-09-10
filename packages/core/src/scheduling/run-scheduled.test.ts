import { describe, it, expect, vi } from "vitest";
import { runScheduledChecks } from "./run-scheduled.js";
import type { PersonRecord } from "../people/types.js";
import type { PeopleStore } from "../people/store.js";
import type { BrokerAdapter, RemovalResult } from "../brokers/types.js";
import type { Page } from "playwright";

function makePerson(overrides: Partial<PersonRecord> = {}): PersonRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    firstName: "John",
    lastName: "Smith",
    emails: [],
    phones: [],
    addresses: [],
    brokerRunHistory: {},
    ...overrides,
  };
}

function makeFakeAdapter(brokerId: string, result: RemovalResult): BrokerAdapter {
  return {
    brokerId,
    brokerName: brokerId,
    method: "form",
    searchUrl: "https://example.com",
    optOutUrl: "https://example.com/optout",
    requiredFields: ["firstName", "lastName"],
    searchFields: ["firstName", "lastName"],
    search: vi.fn(async () => []),
    optOut: vi.fn(async () => result),
  };
}

function makeFakeStore(household: { people: PersonRecord[] }): PeopleStore {
  return {
    name: "fake",
    load: vi.fn(async () => ({ people: household.people, relationships: [] })),
    save: vi.fn(async (h) => {
      household.people = h.people;
    }),
  };
}

const fakePage = {} as Page;

describe("runScheduledChecks", () => {
  it("runs a broker that has never been checked before", async () => {
    const person = makePerson();
    const household = { people: [person] };
    const store = makeFakeStore(household);
    const adapter = makeFakeAdapter("advancedbackgroundchecks", {
      broker: "advancedbackgroundchecks",
      status: "no_match_found",
      timestamp: "2026-09-09T00:00:00.000Z",
      evidence: { candidatesReturned: 0 },
    });

    const summary = await runScheduledChecks({
      store,
      adapters: [adapter],
      page: fakePage,
      dryRun: true,
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    expect(summary.ranCount).toBe(1);
    expect(summary.skippedCount).toBe(0);
    expect(adapter.optOut).not.toHaveBeenCalled(); // dryRun path never calls optOut directly here (no match anyway)
  });

  it("skips a broker that was checked recently (not due yet)", async () => {
    const person = makePerson({
      brokerRunHistory: {
        advancedbackgroundchecks: { lastRunAt: "2026-09-08T00:00:00.000Z", lastStatus: "no_match_found" },
      },
    });
    const household = { people: [person] };
    const store = makeFakeStore(household);
    const adapter = makeFakeAdapter("advancedbackgroundchecks", {
      broker: "advancedbackgroundchecks",
      status: "no_match_found",
      timestamp: "2026-09-09T00:00:00.000Z",
      evidence: {},
    });

    const summary = await runScheduledChecks({
      store,
      adapters: [adapter],
      page: fakePage,
      dryRun: true,
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    expect(summary.ranCount).toBe(0);
    expect(summary.skippedCount).toBe(1);
  });

  it("updates the person's brokerRunHistory rollup and persists it via store.save()", async () => {
    const person = makePerson();
    const household = { people: [person] };
    const store = makeFakeStore(household);
    const adapter = makeFakeAdapter("advancedbackgroundchecks", {
      broker: "advancedbackgroundchecks",
      status: "no_match_found",
      timestamp: "2026-09-09T00:00:00.000Z",
      evidence: {},
    });

    await runScheduledChecks({
      store,
      adapters: [adapter],
      page: fakePage,
      dryRun: true,
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    expect(store.save).toHaveBeenCalled();
    const savedPerson = household.people[0];
    expect(savedPerson.brokerRunHistory.advancedbackgroundchecks.lastStatus).toBe("no_match_found");
    expect(savedPerson.brokerRunHistory.advancedbackgroundchecks.lastRunAt).toBeTruthy();
  });

  it("runs every due (person, broker) pair across multiple people and multiple adapters", async () => {
    const personA = makePerson({ id: "11111111-1111-4111-8111-111111111111" });
    const personB = makePerson({ id: "22222222-2222-4222-8222-222222222222" });
    const household = { people: [personA, personB] };
    const store = makeFakeStore(household);
    const adapterX = makeFakeAdapter("advancedbackgroundchecks", {
      broker: "advancedbackgroundchecks",
      status: "no_match_found",
      timestamp: "2026-09-09T00:00:00.000Z",
      evidence: {},
    });
    const adapterY = makeFakeAdapter("spokeo", {
      broker: "spokeo",
      status: "no_match_found",
      timestamp: "2026-09-09T00:00:00.000Z",
      evidence: {},
    });

    const summary = await runScheduledChecks({
      store,
      adapters: [adapterX, adapterY],
      page: fakePage,
      dryRun: true,
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    // 2 people x 2 brokers, all never-run before -> all 4 due.
    expect(summary.ranCount).toBe(4);
  });

  it("counts a run whose result status is 'failed' toward errorCount, and still processes remaining pairs", async () => {
    const person = makePerson();
    const household = { people: [person] };
    const store = makeFakeStore(household);
    const brokenAdapter: BrokerAdapter = {
      brokerId: "broken",
      brokerName: "broken",
      method: "form",
      searchUrl: "https://example.com",
      optOutUrl: "https://example.com",
      requiredFields: ["firstName", "lastName"],
      search: vi.fn(async () => {
        throw new Error("network error");
      }),
      optOut: vi.fn(async () => {
        throw new Error("should not be called");
      }),
    };
    const workingAdapter = makeFakeAdapter("advancedbackgroundchecks", {
      broker: "advancedbackgroundchecks",
      status: "no_match_found",
      timestamp: "2026-09-09T00:00:00.000Z",
      evidence: {},
    });

    const summary = await runScheduledChecks({
      store,
      adapters: [brokenAdapter, workingAdapter],
      page: fakePage,
      dryRun: true,
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    // runRemoval() itself catches search()/optOut() throwing and returns a
    // "failed" RemovalResult rather than re-throwing (verified existing
    // engine.ts behavior) — so both pairs are attempted (ranCount 2), and
    // the broken one is reflected as an error via its result status, not a
    // thrown exception the scheduler has to catch.
    expect(summary.ranCount).toBe(2);
    expect(summary.errorCount).toBe(1);
  });

  it("passes allowPaywallBypass through to runRemoval when set", async () => {
    const person = makePerson();
    const household = { people: [person] };
    const store = makeFakeStore(household);

    const paywallSearchSpy = vi.fn(async () => [
      { candidateId: "bypassed", observedName: "John Smith", observedCity: "", observedState: "" },
    ]);
    const adapter: BrokerAdapter = {
      ...makeFakeAdapter("checkpeople", {
        broker: "checkpeople",
        status: "submitted",
        timestamp: "2026-09-09T00:00:00.000Z",
        evidence: {},
      }),
      paywallSearch: paywallSearchSpy,
    };

    await runScheduledChecks({
      store,
      adapters: [adapter],
      page: fakePage,
      dryRun: false,
      allowPaywallBypass: true,
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    expect(paywallSearchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not call paywallSearch when allowPaywallBypass is omitted (defaults to false)", async () => {
    const person = makePerson();
    const household = { people: [person] };
    const store = makeFakeStore(household);

    const paywallSearchSpy = vi.fn(async () => [
      { candidateId: "bypassed", observedName: "John Smith", observedCity: "", observedState: "" },
    ]);
    const adapter: BrokerAdapter = {
      ...makeFakeAdapter("checkpeople", {
        broker: "checkpeople",
        status: "submitted",
        timestamp: "2026-09-09T00:00:00.000Z",
        evidence: {},
      }),
      paywallSearch: paywallSearchSpy,
    };

    await runScheduledChecks({
      store,
      adapters: [adapter],
      page: fakePage,
      dryRun: false,
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    expect(paywallSearchSpy).not.toHaveBeenCalled();
  });
});
