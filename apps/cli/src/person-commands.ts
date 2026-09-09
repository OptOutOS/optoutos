import { randomUUID } from "node:crypto";
import type { PeopleStore, PersonRecord, RelationshipType } from "@optoutos/core";
import type { PersonFieldsInput } from "./args.js";

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
