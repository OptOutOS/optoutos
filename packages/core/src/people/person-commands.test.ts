import { describe, it, expect, vi } from "vitest";
import { addPerson, editPerson, listPeople, linkPeople } from "./person-commands.js";
import type { PeopleStore } from "./store.js";
import type { Household } from "./types.js";

function makeMockStore(initial: Household): PeopleStore & { saved: Household[] } {
  const saved: Household[] = [];
  let current = initial;
  return {
    name: "mock",
    saved,
    load: vi.fn(async () => current),
    save: vi.fn(async (h: Household) => {
      current = h;
      saved.push(h);
    }),
  };
}

describe("addPerson", () => {
  it("adds a new person with a generated UUID and persists it", async () => {
    const store = makeMockStore({ people: [], relationships: [] });

    const created = await addPerson(store, { firstName: "John", lastName: "Smith" });

    expect(created.firstName).toBe("John");
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.saved.at(-1)?.people).toHaveLength(1);
  });

  it("preserves existing people already in the store", async () => {
    const existing = { id: "11111111-1111-4111-8111-111111111111", firstName: "Jane", lastName: "Doe", emails: [], phones: [], addresses: [] };
    const store = makeMockStore({ people: [existing], relationships: [] });

    await addPerson(store, { firstName: "John", lastName: "Smith" });

    const saved = store.saved.at(-1);
    expect(saved?.people).toHaveLength(2);
    expect(saved?.people.some((p) => p.id === existing.id)).toBe(true);
  });
});

describe("editPerson", () => {
  const existing = { id: "11111111-1111-4111-8111-111111111111", firstName: "John", lastName: "Smith", emails: [], phones: [], addresses: [] };

  it("merges provided fields into the existing person and persists", async () => {
    const store = makeMockStore({ people: [existing], relationships: [] });

    const updated = await editPerson(store, existing.id, { emails: ["new@example.com"] });

    expect(updated.emails).toEqual(["new@example.com"]);
    expect(updated.firstName).toBe("John"); // unchanged fields preserved
  });

  it("throws when the person id does not exist", async () => {
    const store = makeMockStore({ people: [existing], relationships: [] });

    await expect(editPerson(store, "not-a-real-id", { emails: ["x@example.com"] })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("listPeople", () => {
  it("returns all people in the store", async () => {
    const existing = { id: "11111111-1111-4111-8111-111111111111", firstName: "John", lastName: "Smith", emails: [], phones: [], addresses: [] };
    const store = makeMockStore({ people: [existing], relationships: [] });

    const people = await listPeople(store);

    expect(people).toEqual([existing]);
  });
});

describe("linkPeople", () => {
  const personA = { id: "11111111-1111-4111-8111-111111111111", firstName: "John", lastName: "Smith", emails: [], phones: [], addresses: [] };
  const personB = { id: "22222222-2222-4222-8222-222222222222", firstName: "Jane", lastName: "Smith", emails: [], phones: [], addresses: [] };

  it("adds a relationship edge between two existing people and persists", async () => {
    const store = makeMockStore({ people: [personA, personB], relationships: [] });

    await linkPeople(store, personA.id, personB.id, "spouse");

    const saved = store.saved.at(-1);
    expect(saved?.relationships).toEqual([{ personA: personA.id, personB: personB.id, type: "spouse" }]);
  });

  it("throws when either person id does not exist in the store", async () => {
    const store = makeMockStore({ people: [personA], relationships: [] });

    await expect(linkPeople(store, personA.id, personB.id, "spouse")).rejects.toThrow(/not found/i);
  });
});
