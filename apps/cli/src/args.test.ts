import { describe, it, expect } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs — basic commands", () => {
  it("parses 'list-brokers' with no other args", () => {
    const result = parseArgs(["list-brokers"]);

    expect(result).toEqual({ command: "list-brokers" });
  });

  it("returns a 'help' command for no args", () => {
    const result = parseArgs([]);

    expect(result).toEqual({ command: "help" });
  });

  it("returns a 'help' command for an unknown command", () => {
    const result = parseArgs(["bogus-command"]);

    expect(result).toEqual({ command: "help" });
  });
});

describe("parseArgs — run with --profile (legacy single-file mode)", () => {
  it("parses 'run --broker <id> --profile <path>'", () => {
    const result = parseArgs(["run", "--broker", "thatsthem", "--profile", "./profile.json"]);

    expect(result).toEqual({
      command: "run",
      broker: "thatsthem",
      execute: false,
      source: { kind: "profile-file", path: "./profile.json" },
    });
  });

  it("sets execute:true when --execute is passed", () => {
    const result = parseArgs([
      "run",
      "--broker",
      "thatsthem",
      "--profile",
      "./profile.json",
      "--execute",
    ]);

    expect(result.command).toBe("run");
    if (result.command === "run") {
      expect(result.execute).toBe(true);
    }
  });

  it("throws a clear error when 'run' is missing --broker", () => {
    expect(() => parseArgs(["run", "--profile", "./profile.json"])).toThrow(/--broker/);
  });

  it("throws if neither --profile nor --person is given", () => {
    expect(() => parseArgs(["run", "--broker", "thatsthem"])).toThrow(/--profile|--person/);
  });
});

describe("parseArgs — run with --person (household-backed)", () => {
  it("parses --broker/--person/--store", () => {
    const result = parseArgs([
      "run",
      "--broker",
      "thatsthem",
      "--person",
      "11111111-1111-4111-8111-111111111111",
      "--store",
      "./h.json",
    ]);

    expect(result).toEqual({
      command: "run",
      broker: "thatsthem",
      execute: false,
      source: {
        kind: "household",
        store: { kind: "local-file", path: "./h.json" },
        personId: "11111111-1111-4111-8111-111111111111",
      },
    });
  });

  it("throws if both --profile and --person are given (ambiguous source)", () => {
    expect(() =>
      parseArgs([
        "run",
        "--broker",
        "thatsthem",
        "--profile",
        "./profile.json",
        "--person",
        "11111111-1111-4111-8111-111111111111",
        "--store",
        "./h.json",
      ]),
    ).toThrow(/only one/i);
  });

  it("throws if --person is given without a store selector", () => {
    expect(() =>
      parseArgs(["run", "--broker", "thatsthem", "--person", "11111111-1111-4111-8111-111111111111"]),
    ).toThrow(/--store/);
  });
});

describe("parseArgs — store selector (shared by person/run commands)", () => {
  it("parses --store <path> as a local-file store selector", () => {
    const result = parseArgs(["person", "list", "--store", "./household.enc.json"]);

    expect(result).toEqual({
      command: "person-list",
      store: { kind: "local-file", path: "./household.enc.json" },
    });
  });

  it("parses --store-bws <secretId> as a BWS store selector", () => {
    const result = parseArgs(["person", "list", "--store-bws", "some-secret-id"]);

    expect(result).toEqual({
      command: "person-list",
      store: { kind: "bws", secretId: "some-secret-id" },
    });
  });

  it("throws if neither --store nor --store-bws is given", () => {
    expect(() => parseArgs(["person", "list"])).toThrow(/--store/);
  });

  it("throws if BOTH --store and --store-bws are given (ambiguous)", () => {
    expect(() =>
      parseArgs(["person", "list", "--store", "./a.json", "--store-bws", "some-id"]),
    ).toThrow(/only one/i);
  });
});

describe("parseArgs — person add", () => {
  it("parses required --first/--last plus a store selector", () => {
    const result = parseArgs([
      "person",
      "add",
      "--store",
      "./household.enc.json",
      "--first",
      "John",
      "--last",
      "Smith",
    ]);

    expect(result).toEqual({
      command: "person-add",
      store: { kind: "local-file", path: "./household.enc.json" },
      fields: { firstName: "John", lastName: "Smith" },
    });
  });

  it("parses optional fields (email, phone, address, dob, notes)", () => {
    const result = parseArgs([
      "person",
      "add",
      "--store",
      "./household.enc.json",
      "--first",
      "John",
      "--last",
      "Smith",
      "--email",
      "john@example.com",
      "--phone",
      "2065551234",
      "--street",
      "123 Main St",
      "--city",
      "Seattle",
      "--state",
      "WA",
      "--zip",
      "98101",
      "--dob",
      "1980-01-01",
      "--notes",
      "test note",
    ]);

    expect(result.command).toBe("person-add");
    if (result.command === "person-add") {
      expect(result.fields.emails).toEqual(["john@example.com"]);
      expect(result.fields.phones).toEqual(["2065551234"]);
      expect(result.fields.addresses).toEqual([
        { street: "123 Main St", city: "Seattle", state: "WA", zip: "98101" },
      ]);
      expect(result.fields.dateOfBirth).toBe("1980-01-01");
      expect(result.fields.notes).toBe("test note");
    }
  });

  it("throws when --first is missing", () => {
    expect(() =>
      parseArgs(["person", "add", "--store", "./h.json", "--last", "Smith"]),
    ).toThrow(/--first/);
  });

  it("throws when --last is missing", () => {
    expect(() =>
      parseArgs(["person", "add", "--store", "./h.json", "--first", "John"]),
    ).toThrow(/--last/);
  });
});

describe("parseArgs — person edit", () => {
  it("parses --id plus any fields to update", () => {
    const result = parseArgs([
      "person",
      "edit",
      "--store",
      "./h.json",
      "--id",
      "11111111-1111-4111-8111-111111111111",
      "--email",
      "new@example.com",
    ]);

    expect(result.command).toBe("person-edit");
    if (result.command === "person-edit") {
      expect(result.id).toBe("11111111-1111-4111-8111-111111111111");
      expect(result.fields.emails).toEqual(["new@example.com"]);
    }
  });

  it("throws when --id is missing", () => {
    expect(() => parseArgs(["person", "edit", "--store", "./h.json"])).toThrow(/--id/);
  });
});

describe("parseArgs — person list", () => {
  it("parses with just a store selector", () => {
    const result = parseArgs(["person", "list", "--store", "./h.json"]);

    expect(result.command).toBe("person-list");
  });
});

describe("parseArgs — person link", () => {
  it("parses --a/--b/--type plus a store selector", () => {
    const result = parseArgs([
      "person",
      "link",
      "--store",
      "./h.json",
      "--a",
      "11111111-1111-4111-8111-111111111111",
      "--b",
      "22222222-2222-4222-8222-222222222222",
      "--type",
      "spouse",
    ]);

    expect(result).toEqual({
      command: "person-link",
      store: { kind: "local-file", path: "./h.json" },
      personA: "11111111-1111-4111-8111-111111111111",
      personB: "22222222-2222-4222-8222-222222222222",
      relationshipType: "spouse",
    });
  });

  it("throws for an unknown --type", () => {
    expect(() =>
      parseArgs([
        "person",
        "link",
        "--store",
        "./h.json",
        "--a",
        "11111111-1111-4111-8111-111111111111",
        "--b",
        "22222222-2222-4222-8222-222222222222",
        "--type",
        "arch-nemesis",
      ]),
    ).toThrow(/relationship type/i);
  });

  it("throws when --a, --b, or --type is missing", () => {
    expect(() =>
      parseArgs(["person", "link", "--store", "./h.json", "--a", "11111111-1111-4111-8111-111111111111"]),
    ).toThrow(/--b|--type/);
  });
});

describe("parseArgs — unknown person subcommand", () => {
  it("returns help for an unrecognized person subcommand", () => {
    const result = parseArgs(["person", "delete-everything"]);

    expect(result).toEqual({ command: "help" });
  });
});

describe("parseArgs — schedule-run", () => {
  it("parses 'schedule-run --store <path>' with no --broker (means: all brokers)", () => {
    const result = parseArgs(["schedule-run", "--store", "./h.json"]);

    expect(result).toEqual({
      command: "schedule-run",
      store: { kind: "local-file", path: "./h.json" },
      brokers: undefined,
      execute: false,
    });
  });

  it("parses --broker to restrict to a single broker (repeatable)", () => {
    const result = parseArgs([
      "schedule-run",
      "--store",
      "./h.json",
      "--broker",
      "advancedbackgroundchecks",
      "--broker",
      "spokeo",
    ]);

    expect(result.command).toBe("schedule-run");
    if (result.command === "schedule-run") {
      expect(result.brokers).toEqual(["advancedbackgroundchecks", "spokeo"]);
    }
  });

  it("sets execute:true when --execute is passed", () => {
    const result = parseArgs(["schedule-run", "--store", "./h.json", "--execute"]);

    expect(result.command).toBe("schedule-run");
    if (result.command === "schedule-run") {
      expect(result.execute).toBe(true);
    }
  });

  it("supports --store-bws just like other commands", () => {
    const result = parseArgs(["schedule-run", "--store-bws", "some-secret-id"]);

    expect(result).toEqual({
      command: "schedule-run",
      store: { kind: "bws", secretId: "some-secret-id" },
      brokers: undefined,
      execute: false,
    });
  });

  it("throws if neither --store nor --store-bws is given", () => {
    expect(() => parseArgs(["schedule-run"])).toThrow(/--store/);
  });
});
