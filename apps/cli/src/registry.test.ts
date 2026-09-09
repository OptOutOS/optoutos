import { describe, it, expect } from "vitest";
import { getBrokerAdapter, listBrokerIds } from "./registry.js";

describe("broker registry", () => {
  it("lists all known broker ids", () => {
    const ids = listBrokerIds();

    expect(ids).toContain("thatsthem");
    expect(ids).toContain("advancedbackgroundchecks");
    expect(ids.length).toBeGreaterThanOrEqual(11);
  });

  it("returns a broker adapter instance for a known broker id", () => {
    const adapter = getBrokerAdapter("thatsthem");

    expect(adapter).toBeDefined();
    expect(adapter?.brokerId).toBe("thatsthem");
  });

  it("returns undefined for an unknown broker id", () => {
    const adapter = getBrokerAdapter("not-a-real-broker");

    expect(adapter).toBeUndefined();
  });
});
