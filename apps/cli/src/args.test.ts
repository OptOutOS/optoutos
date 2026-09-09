import { describe, it, expect } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("parses 'list-brokers' with no other args", () => {
    const result = parseArgs(["list-brokers"]);

    expect(result).toEqual({ command: "list-brokers" });
  });

  it("parses 'run --broker <id> --profile <path>'", () => {
    const result = parseArgs(["run", "--broker", "thatsthem", "--profile", "./profile.json"]);

    expect(result).toEqual({
      command: "run",
      broker: "thatsthem",
      profilePath: "./profile.json",
      execute: false,
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

  it("throws a clear error when 'run' is missing --profile", () => {
    expect(() => parseArgs(["run", "--broker", "thatsthem"])).toThrow(/--profile/);
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
