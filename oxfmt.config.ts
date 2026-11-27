import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [".e2e/**", "node_modules/**", "dist/**", ".alchemy/**", "nub.lock"],
});
