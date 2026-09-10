import { globalIgnores, js, ts } from "@rslint/core";

// Shared Rslint building blocks for the OptOutOS monorepo. Import this
// from each package's own rslint.config.ts (packages/core, apps/cli) -
// don't reference a single root rslint.config.ts via --config from a
// sub-package. Verified 2026-09-10: a config file needs to live inside
// (or above, via normal ancestor discovery) the linted package's own
// directory for type-aware rules (languageOptions.parserOptions.projectService)
// to find that package's tsconfig.json. A shared root config pointed at
// via --config from another directory, or run with a mismatched CWD,
// silently drops type-aware rules with NO warning or error - lint
// reports "passed" even on code with real type-aware violations. Always
// verify rule count in the CLI's own summary line (e.g. "69 rules") stays
// consistent, and periodically confirm with a deliberate throwaway
// violation that the linter still fires before trusting a config change.
export const sharedRslintConfig = [
  globalIgnores(["**/dist/**", "**/node_modules/**", "**/*.mjs", "**/__fixtures__/**"]),
  js.configs.recommended,
  ts.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
    },
  },
];
