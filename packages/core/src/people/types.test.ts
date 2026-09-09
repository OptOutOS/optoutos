import { describe, it, expect } from "vitest";
import { PersonRecordSchema, RelationshipEdgeSchema, HouseholdSchema, RelationshipType } from "./types.js";

describe("PersonRecordSchema", () => {
  it("accepts a minimal valid person (just names)", () => {
    const result = PersonRecordSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      firstName: "John",
      lastName: "Smith",
    });

    expect(result.success).toBe(true);
  });

  it("defaults emails/phones/addresses/relatives to empty arrays", () => {
    const parsed = PersonRecordSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      firstName: "John",
      lastName: "Smith",
    });

    expect(parsed.emails).toEqual([]);
    expect(parsed.phones).toEqual([]);
    expect(parsed.addresses).toEqual([]);
  });

  it("rejects a person missing firstName", () => {
    const result = PersonRecordSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      lastName: "Smith",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID id", () => {
    const result = PersonRecordSchema.safeParse({
      id: "not-a-uuid",
      firstName: "John",
      lastName: "Smith",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a full profile with all fields", () => {
    const result = PersonRecordSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      firstName: "John",
      lastName: "Smith",
      middleName: "Q",
      dateOfBirth: "1980-01-01",
      emails: ["john@example.com"],
      phones: ["2065551234"],
      addresses: [{ street: "123 Main St", city: "Seattle", state: "WA", zip: "98101", country: "US" }],
    });

    expect(result.success).toBe(true);
  });
});

describe("RelationshipEdgeSchema", () => {
  const validPersonA = "11111111-1111-4111-8111-111111111111";
  const validPersonB = "22222222-2222-4222-8222-222222222222";

  it("accepts a valid typed edge between two person ids", () => {
    const result = RelationshipEdgeSchema.safeParse({
      personA: validPersonA,
      personB: validPersonB,
      type: "spouse",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an edge where personA === personB (self-relationship)", () => {
    const result = RelationshipEdgeSchema.safeParse({
      personA: validPersonA,
      personB: validPersonA,
      type: "spouse",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown relationship type", () => {
    const result = RelationshipEdgeSchema.safeParse({
      personA: validPersonA,
      personB: validPersonB,
      type: "arch-nemesis",
    });

    expect(result.success).toBe(false);
  });

  it("accepts every documented RelationshipType", () => {
    const types: RelationshipType[] = ["spouse", "parent", "child", "sibling", "other"];
    for (const type of types) {
      const result = RelationshipEdgeSchema.safeParse({ personA: validPersonA, personB: validPersonB, type });
      expect(result.success).toBe(true);
    }
  });
});

describe("HouseholdSchema", () => {
  const personA = { id: "11111111-1111-4111-8111-111111111111", firstName: "John", lastName: "Smith" };
  const personB = { id: "22222222-2222-4222-8222-222222222222", firstName: "Jane", lastName: "Smith" };

  it("accepts a household with people and a relationship between them", () => {
    const result = HouseholdSchema.safeParse({
      people: [personA, personB],
      relationships: [{ personA: personA.id, personB: personB.id, type: "spouse" }],
    });

    expect(result.success).toBe(true);
  });

  it("defaults to empty people/relationships", () => {
    const parsed = HouseholdSchema.parse({});

    expect(parsed.people).toEqual([]);
    expect(parsed.relationships).toEqual([]);
  });

  it("rejects a relationship referencing a personId not present in people", () => {
    const result = HouseholdSchema.safeParse({
      people: [personA],
      relationships: [{ personA: personA.id, personB: personB.id, type: "spouse" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate person ids within the same household", () => {
    const result = HouseholdSchema.safeParse({
      people: [personA, { ...personB, id: personA.id }],
    });

    expect(result.success).toBe(false);
  });
});
