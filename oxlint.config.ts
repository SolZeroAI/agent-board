import { defineConfig } from "oxlint";
import { agentToolIgnorePatterns, effectRules, recommended } from "oxlint-plugin-solzero/config";

const effectFiles = ["packages/**/*.ts", "alchemy.run.ts"];

export default defineConfig({
  extends: [recommended],
  options: { reportUnusedDisableDirectives: "error" },
  plugins: ["unicorn", "typescript", "oxc"],
  jsPlugins: [{ name: "effect", specifier: "@mpsuesser/oxlint-plugin-effect" }],
  ignorePatterns: [...agentToolIgnorePatterns, "node_modules", "dist", "**/.alchemy/**", ".e2e/**"],
  rules: {
    "max-lines": ["error", { max: 1000, skipBlankLines: false, skipComments: false }],
    "solzero/no-colocated-tests": "error",
    "no-restricted-properties": [
      "error",
      {
        object: "Math",
        property: "random",
        message:
          "Use crypto.randomUUID() for identifiers and crypto.getRandomValues() for random bytes.",
      },
    ],
  },
  overrides: [
    {
      files: effectFiles,
      rules: {
        ...effectRules("error"),
        "effect/prefer-effect-fn": "error",
        "effect/prefer-namespace-imports": "error",
        "effect/avoid-process-env": "error",
        "effect/avoid-any": "error",
        "effect/avoid-try-catch": "error",
        "effect/require-effect-concurrency": "error",
      },
    },
    {
      // The stack wires Alchemy resources. Effect.fn changes that inference.
      files: ["alchemy.run.ts"],
      rules: {
        "effect/prefer-effect-fn": "off",
        "effect/avoid-process-env": "off",
      },
    },
    {
      // The e2e runner reads model ids from the process environment before any Effect runtime exists.
      files: ["e2e.config.ts", "scripts/**/*.ts"],
      rules: {
        "effect/avoid-process-env": "off",
      },
    },
    {
      // Domain decide and evolve handlers are pure functions. Alchemy Domain's
      // own guides write them with if, ternaries, and `_tag` state literals.
      // Those handlers return events or a rejection. They are not Effect pipelines.
      files: ["packages/domain/**/*.ts"],
      rules: {
        "solzero/no-if-statement": "off",
        "solzero/no-ternary": "off",
        "solzero/no-return-in-arrow": "off",
        "anti-slop-effect/no-manual-tag-comparison": "off",
        "anti-slop-effect/no-manual-tagged-construction": "off",
        "anti-slop/no-conditional-empty-object-spread": "off",
      },
    },
    {
      // Cloudflare.Worker takes an effect that returns `{ fetch: Effect }`.
      // The outer effect builds the handlers. The inner effect is the request.
      files: ["packages/server/src/BoardWorker.ts"],
      rules: {
        "solzero/no-nested-effect-gen": "off",
        "solzero/no-if-statement": "off",
      },
    },
    {
      // Session verification follows Alchemy's bearer-token example: split the
      // token, then branch on the signature. Context.Service requires its type
      // parameters, so the channel tuple is the service declaration.
      files: ["packages/server/src/SessionLive.ts"],
      rules: {
        "solzero/no-if-statement": "off",
        "solzero/no-ternary": "off",
        "solzero/no-manual-effect-channels": "off",
        "solzero/no-match-effect-branch": "off",
      },
    },
  ],
});
