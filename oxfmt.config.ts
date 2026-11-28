import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [".e2e/**", "node_modules/**", "dist/**", ".alchemy/**", "nub.lock"],
  overrides: [
    {
      // Copied verbatim across SolZero repositories, which format this file without semicolons.
      files: ["scripts/e2e/filters.ts"],
      options: { semi: false },
    },
  ],
});
