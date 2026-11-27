import { decisionExecutor, decisionFilter } from "@e2e-dev/decision";
import { github } from "@e2e-dev/github";
import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

import { e2eModels } from "./scripts/e2e/models.ts";

// The suite calls the account's default AI Gateway with CF_AI_GATEWAY_E2E_TOKEN.
// Placeholders let secret-free test collection load this module.
const { decisionModel, languageModel } = e2eModels({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID || "unconfigured",
  gatewayId: process.env.CF_AI_GATEWAY_E2E_ID || "default",
  token: process.env.CF_AI_GATEWAY_E2E_TOKEN || "unconfigured",
});

export default {
  projectId: "agent-board",
  tests: "tests/**/*.e2e.ts",
  targets: [
    {
      name: "local",
      engine: web(),
      app: {
        url: "http://127.0.0.1:8787",
        environment: "test",
        command: {
          executable: "nub",
          args: ["run", "dev"],
          // Local emulation. The child does not inherit a Cloudflare API token or account id.
          env: {
            CI: "1",
            ALCHEMY_STAGE: "dev",
          },
          startupTimeout: 180_000,
          shutdownTimeout: 60_000,
          log: ".e2e/logs/stack.log",
        },
      },
    },
  ],
  agents: {
    default: {
      executor: decisionExecutor({ model: decisionModel, textModel: languageModel }),
      providerOptions: { openai: { reasoningEffort: "low" } },
      maxModelCalls: 20,
      maxSteps: 20,
      context:
        "Local Agent Board. Use only the disposable board created by the test. Do not deploy, pay, or send messages outside the local server.",
    },
  },
  filters: [decisionFilter({ model: decisionModel })],
  workers: 1,
  retries: 0,
  timeout: 180_000,
  assertionTimeout: 20_000,
  cache: { mode: "read-write", dir: process.env.E2E_ACTION_CACHE_DIR ?? ".e2e/cache" },
  reporters: ["list", "junit", "markdown", github({ key: "agent-board-core" })],
  trace: "off",
} satisfies E2EConfig;
