import { tegami } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

const repository = process.env.GITHUB_REPOSITORY?.trim() || "SolZeroAI/agent-board";

const release = tegami({
  conventionalCommits: false,
  npm: {
    client: "nub",
    updateLockFile: false,
  },
  plugins: [
    github({
      repo: repository,
      versionPr: {
        base: "master",
        branch: "tegami/version-packages",
      },
    }),
  ],
});

await runCli(release);
