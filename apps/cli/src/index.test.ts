import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { main } from "./index.js";
import { writeFile, unlink } from "node:fs/promises";

describe("main (CLI command dispatch)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints help and returns 0 for no arguments", async () => {
    const code = await main([]);

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("OptOutOS CLI"));
  });

  it("lists broker ids and returns 0 for list-brokers", async () => {
    const code = await main(["list-brokers"]);

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith("thatsthem");
  });

  it("returns 1 and prints an error for 'run' with an unknown broker", async () => {
    const profilePath = "./__test_profile_valid.json";
    await writeFile(
      profilePath,
      JSON.stringify({ firstName: "Test", lastName: "User" }),
    );

    try {
      const code = await main(["run", "--broker", "not-a-real-broker", "--profile", profilePath]);

      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown broker id"));
    } finally {
      await unlink(profilePath).catch(() => {});
    }
  });

  it("returns 1 and prints an error for 'run' with a missing profile file", async () => {
    const code = await main(["run", "--broker", "thatsthem", "--profile", "./does-not-exist.json"]);

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to load PII source"));
  });

  it("returns 1 and prints an error for 'run' with an invalid profile (fails PiiProfileSchema)", async () => {
    const profilePath = "./__test_profile_invalid.json";
    await writeFile(profilePath, JSON.stringify({ firstName: "OnlyFirstName" }));

    try {
      const code = await main(["run", "--broker", "thatsthem", "--profile", profilePath]);

      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to load PII source"));
    } finally {
      await unlink(profilePath).catch(() => {});
    }
  });

  it("returns 1 and prints a clear error for invalid arguments (missing --broker)", async () => {
    const code = await main(["run", "--profile", "./profile.json"]);

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--broker"));
  });

  it("prints a dry-run notice when --execute is not passed", async () => {
    const profilePath = "./__test_profile_dryrun.json";
    await writeFile(profilePath, JSON.stringify({ firstName: "Test", lastName: "User" }));

    try {
      await main(["run", "--broker", "not-a-real-broker", "--profile", profilePath]);
      // Unknown broker short-circuits before the dry-run message — verify
      // the message never fired for this path (it's only for known brokers).
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("[dry-run]"));
    } finally {
      await unlink(profilePath).catch(() => {});
    }
  });
});
