import type { Household } from "./types.js";

/**
 * Pluggable backend for the persistent, multi-person household PII store.
 *
 * ISOLATION MODEL: one PeopleStore instance == one household/owner. There is
 * no multi-tenant "list all households" or cross-household query anywhere in
 * this interface, by design — a deployment serving multiple unrelated
 * top-level users constructs one PeopleStore per user/household, each
 * pointed at its own file or its own BWS secret. See types.ts design note.
 */
export interface PeopleStore {
  readonly name: string;
  load(): Promise<Household>;
  save(household: Household): Promise<void>;
}
