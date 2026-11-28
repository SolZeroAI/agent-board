import { tegami } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";
import { agentBoardRelease } from "./releases/agent-board-release.ts";

// Agent Board ships one release: the alchemy.new registry package. The workspace packages
// are private, so Tegami versions the root VERSION file and tags v<version>.
const release = tegami({
  ignore: [/^npm:/],
  npm: {
    client: "nub",
    updateLockFile: false,
  },
  plugins: [
    github({
      repo: "SolZeroAI/agent-board",
      release: {
        eager: false,
        create({ pkg }) {
          return { title: `Agent Board v${pkg.version}` };
        },
      },
      versionPr: {
        base: "master",
        branch: "tegami/version-packages",
      },
    }),
    agentBoardRelease(),
  ],
});

await runCli(release);
