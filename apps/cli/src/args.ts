export type ParsedArgs =
  | { command: "help" }
  | { command: "list-brokers" }
  | { command: "run"; broker: string; profilePath: string; execute: boolean };

/**
 * Minimal, dependency-free CLI argument parser.
 *
 * Deliberately does not pull in a CLI framework (yargs/commander) for such
 * a small surface — reduces the dependency footprint of a privacy tool that
 * handles PII, per the project's privacy-first design principles.
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
    const flags = parseFlags(rest);
    const broker = flags.get("--broker");
    const profilePath = flags.get("--profile");
    const execute = flags.has("--execute");

    if (!broker) {
      throw new Error("Missing required flag: --broker <brokerId>");
    }
    if (!profilePath) {
      throw new Error("Missing required flag: --profile <path-to-profile.json>");
    }

    return { command: "run", broker, profilePath, execute };
  }

  return { command: "help" };
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
