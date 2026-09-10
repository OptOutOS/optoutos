import { describe, it, expect, vi } from "vitest";
import { PublicDataUsaAdapter } from "./publicdatausa.js";

describe("PublicDataUsaAdapter", () => {
  it("declares no required fields and no search capability (unreachable-domain placeholder)", () => {
    const adapter = new PublicDataUsaAdapter();

    expect(adapter.brokerId).toBe("publicdatausa");
    expect(adapter.method).toBe("form");
    expect(adapter.requiredFields).toEqual([]);
    expect(adapter.search).toBeUndefined();
  });

  it("fails closed with a DNS_BLOCKED evidence marker and never touches the page", async () => {
    const adapter = new PublicDataUsaAdapter();
    const page = {
      goto: vi.fn(),
      locator: vi.fn(),
    };

    const result = await adapter.optOut(page as never, {});

    expect(result.status).toBe("failed");
    expect(result.broker).toBe("publicdatausa");
    expect(result.evidence.dnsStatus).toBe("DNS_BLOCKED");
    expect(result.error).toMatch(/DNS SERVFAIL/);
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.locator).not.toHaveBeenCalled();
  });

  it("returns a fresh ISO 8601 timestamp on every call", async () => {
    const adapter = new PublicDataUsaAdapter();
    const page = { goto: vi.fn(), locator: vi.fn() };

    const result = await adapter.optOut(page as never, {});

    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
