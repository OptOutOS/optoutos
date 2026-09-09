import { describe, it, expect } from "vitest";
import { PiiProfileSchema } from "./pii.js";

describe("PiiProfileSchema (zod validation)", () => {
  it("accepts a valid profile with valid emails", () => {
    const result = PiiProfileSchema.parse({
      firstName: "John",
      lastName: "Smith",
      emails: ["john@example.com"],
      phones: ["2065551234"],
      addresses: [],
      relatives: [],
    });
    expect(result.emails).toEqual(["john@example.com"]);
  });

  it("rejects an invalid email address", () => {
    expect(() =>
      PiiProfileSchema.parse({
        firstName: "John",
        lastName: "Smith",
        emails: ["not-an-email"],
      }),
    ).toThrow();
  });

  it("applies default empty arrays for optional collection fields", () => {
    const result = PiiProfileSchema.parse({
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(result.emails).toEqual([]);
    expect(result.phones).toEqual([]);
    expect(result.addresses).toEqual([]);
    expect(result.relatives).toEqual([]);
  });

  it("requires firstName and lastName", () => {
    expect(() => PiiProfileSchema.parse({})).toThrow();
  });
});
