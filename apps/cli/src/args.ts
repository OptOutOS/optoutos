import { RELATIONSHIP_TYPES, type RelationshipType } from "@optoutos/core";

export type StoreSelector =
  | { kind: "local-file"; path: string }
  | { kind: "bws"; secretId: string };

export type RunSource =
  | { kind: "profile-file"; path: string }
  | { kind: "household"; store: StoreSelector; personId: string };

export interface PersonFieldsInput {
  firstName?: string;
  lastName?: string;
  emails?: string[];
  phones?: string[];
  addresses?: { street: string; city: string; state: string; zip: string }[];
  dateOfBirth?: string;
  notes?: string;
}

export type ParsedArgs =
  | { command: "help" }
  | { command: "list-brokers" }
  | { command: "run"; broker: string; execute: boolean; source: RunSource }
  | { command: "person-add"; store: StoreSelector; fields: PersonFieldsInput & { firstName: string; lastName: string } }
  | { command: "person-edit"; store: StoreSelector; id: string; fields: PersonFieldsInput }
  | { command: "person-list"; store: StoreSelector }
  | {
      command: "person-link";
      store: StoreSelector;
      personA: string;
      personB: string;
      relationshipType: RelationshipType;
    };

/**
 * Minimal, dependency-free CLI argument parser.
 *
 * Deliberately does not pull in a CLI framework (yargs/commander) for such
 * a small surface — reduces the dependency footprint of a privacy tool that
 * handles PII, per the project's privacy-first design principles.
 *
 * SECURITY NOTE: store passphrases are deliberately NEVER accepted as a
 * flag/argv value here — they would land in shell history and be visible to
 * any other process via `ps`/Task Manager. --store <path> only selects
 * WHICH local-encrypted-file store to use; its passphrase is read from the
 * OPTOUTOS_PASSPHRASE environment variable at the point of use (see
 * store-factory.ts). Similarly --store-bws only selects the secret id; the
 * BWS_ACCESS_TOKEN env var (existing project convention) supplies the
 * credential.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;

  if (!command) {
    return { command: "help" };
  }

  if (command === "list-brokers") {
    return { command: "list-brokers" };
  }

  if (command === "run") {
    return parseRun(rest);
  }

  if (command === "person") {
    return parsePerson(rest);
  }

  return { command: "help" };
}

function parseRun(rest: string[]): ParsedArgs {
  const flags = parseFlags(rest);
  const broker = flags.get("--broker");
  const execute = flags.has("--execute");
  const profilePath = flags.get("--profile");
  const personId = flags.get("--person");

  if (!broker) {
    throw new Error("Missing required flag: --broker <brokerId>");
  }

  if (profilePath && personId) {
    throw new Error("Pass only one of --profile or --person, not both (ambiguous PII source).");
  }

  if (profilePath) {
    return { command: "run", broker, execute, source: { kind: "profile-file", path: profilePath } };
  }

  if (personId) {
    const store = parseStoreSelector(flags);
    return { command: "run", broker, execute, source: { kind: "household", store, personId } };
  }

  throw new Error(
    "Missing PII source: pass either --profile <path-to-profile.json> or --person <id> --store <path>.",
  );
}

function parsePerson(rest: string[]): ParsedArgs {
  const [subcommand, ...subRest] = rest;
  const flags = parseFlags(subRest);

  if (subcommand === "add") {
    const store = parseStoreSelector(flags);
    const firstName = flags.get("--first");
    const lastName = flags.get("--last");
    if (!firstName) throw new Error("Missing required flag: --first <firstName>");
    if (!lastName) throw new Error("Missing required flag: --last <lastName>");

    return {
      command: "person-add",
      store,
      fields: { firstName, lastName, ...parseOptionalPersonFields(flags) },
    };
  }

  if (subcommand === "edit") {
    const store = parseStoreSelector(flags);
    const id = flags.get("--id");
    if (!id) throw new Error("Missing required flag: --id <personId>");

    return { command: "person-edit", store, id, fields: parseOptionalPersonFields(flags) };
  }

  if (subcommand === "list") {
    const store = parseStoreSelector(flags);
    return { command: "person-list", store };
  }

  if (subcommand === "link") {
    const store = parseStoreSelector(flags);
    const personA = flags.get("--a");
    const personB = flags.get("--b");
    const type = flags.get("--type");

    if (!personA || !personB || !type) {
      throw new Error("Missing required flags: --a <personId> --b <personId> --type <relationshipType>");
    }
    if (!(RELATIONSHIP_TYPES as readonly string[]).includes(type)) {
      throw new Error(
        `Unknown relationship type "${type}". Must be one of: ${RELATIONSHIP_TYPES.join(", ")}`,
      );
    }

    return {
      command: "person-link",
      store,
      personA,
      personB,
      relationshipType: type as RelationshipType,
    };
  }

  return { command: "help" };
}

function parseOptionalPersonFields(flags: ReturnType<typeof parseFlags>): PersonFieldsInput {
  const fields: PersonFieldsInput = {};

  const email = flags.get("--email");
  if (email) fields.emails = [email];

  const phone = flags.get("--phone");
  if (phone) fields.phones = [phone];

  const street = flags.get("--street");
  const city = flags.get("--city");
  const state = flags.get("--state");
  const zip = flags.get("--zip");
  if (street && city && state && zip) {
    fields.addresses = [{ street, city, state, zip }];
  }

  const dob = flags.get("--dob");
  if (dob) fields.dateOfBirth = dob;

  const notes = flags.get("--notes");
  if (notes) fields.notes = notes;

  return fields;
}

function parseStoreSelector(flags: ReturnType<typeof parseFlags>): StoreSelector {
  const path = flags.get("--store");
  const secretId = flags.get("--store-bws");

  if (path && secretId) {
    throw new Error("Pass only one of --store or --store-bws, not both (ambiguous store backend).");
  }
  if (path) {
    return { kind: "local-file", path };
  }
  if (secretId) {
    return { kind: "bws", secretId };
  }
  throw new Error("Missing store selector: pass --store <path> or --store-bws <secretId>.");
}

function parseFlags(args: string[]): Map<string, string> & { has(flag: string): boolean } {
  const map = new Map<string, string>() as Map<string, string> & { has(flag: string): boolean };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute") {
      map.set("--execute", "true");
      continue;
    }
    if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        map.set(arg, value);
        i++;
      }
    }
  }
  return map;
}
