import { randomUUID } from "node:crypto";
import type { PeopleStore } from "./store.js";
import type { PersonRecord, RelationshipType } from "./types.js";

/**
 * Fields accepted for creating/editing a PersonRecord — shared by both the
 * CLI (apps/cli/src/args.ts) and the web GUI (apps/web), which each have
 * their own way of collecting these (flags vs a form) but must funnel into
 * this one implementation so household mutation logic isn't duplicated.
 */
export interface PersonFieldsInput {
  firstName?: string;
  lastName?: string;
  emails?: string[];
  phones?: string[];
  addresses?: { street: string; city: string; state: string; zip: string }[];
  dateOfBirth?: string;
  notes?: string;
}

export async function addPerson(
  store: PeopleStore,
  fields: PersonFieldsInput & { firstName: string; lastName: string },
): Promise<PersonRecord> {
  const household = await store.load();

  const newPerson: PersonRecord = {
    id: randomUUID(),
    firstName: fields.firstName,
    lastName: fields.lastName,
    emails: fields.emails ?? [],
    phones: fields.phones ?? [],
    addresses: fields.addresses?.map((a) => ({ ...a, country: "US" })) ?? [],
    dateOfBirth: fields.dateOfBirth,
    notes: fields.notes,
    brokerRunHistory: {},
  };

  await store.save({ ...household, people: [...household.people, newPerson] });
  return newPerson;
}

export async function editPerson(
  store: PeopleStore,
  id: string,
  fields: PersonFieldsInput,
): Promise<PersonRecord> {
  const household = await store.load();
  const existing = household.people.find((p) => p.id === id);
  if (!existing) {
    throw new Error(`Person not found: ${id}`);
  }

  const updated: PersonRecord = {
    ...existing,
    ...(fields.firstName !== undefined && { firstName: fields.firstName }),
    ...(fields.lastName !== undefined && { lastName: fields.lastName }),
    ...(fields.emails !== undefined && { emails: fields.emails }),
    ...(fields.phones !== undefined && { phones: fields.phones }),
    ...(fields.addresses !== undefined && {
      addresses: fields.addresses.map((a) => ({ ...a, country: "US" })),
    }),
    ...(fields.dateOfBirth !== undefined && { dateOfBirth: fields.dateOfBirth }),
    ...(fields.notes !== undefined && { notes: fields.notes }),
  };

  const people = household.people.map((p) => (p.id === id ? updated : p));
  await store.save({ ...household, people });
  return updated;
}

export async function listPeople(store: PeopleStore): Promise<PersonRecord[]> {
  const household = await store.load();
  return household.people;
}

export async function linkPeople(
  store: PeopleStore,
  personA: string,
  personB: string,
  type: RelationshipType,
): Promise<void> {
  const household = await store.load();
  const ids = new Set(household.people.map((p) => p.id));

  if (!ids.has(personA)) throw new Error(`Person not found: ${personA}`);
  if (!ids.has(personB)) throw new Error(`Person not found: ${personB}`);

  await store.save({
    ...household,
    relationships: [...household.relationships, { personA, personB, type }],
  });
}
