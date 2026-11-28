import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type TegamiPlugin, WorkspacePackage } from "tegami";
import { GitTagPublishTask } from "tegami/plugins/git";

const VERSION_FILE = "VERSION";
const CHANGELOG_FILE = "CHANGELOG.md";

// One SemVer release version, such as 0.1.0 or 0.1.0-beta.1.
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const VERSION_HEADING = /^## (\S+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

class AgentBoardReleasePackage extends WorkspacePackage {
  readonly manager = "release";
  readonly name = "agent-board";
  readonly path: string;
  #version: string;

  constructor(root: string, version: string) {
    super();
    this.path = root;
    this.#version = version;
  }

  get version(): string {
    return this.#version;
  }

  setVersion(version: string): void {
    this.#version = version;
  }
}

class AgentBoardGitTagPublishTask extends GitTagPublishTask<AgentBoardReleasePackage> {}

async function readVersion(root: string): Promise<string> {
  const version = (await readFile(join(root, VERSION_FILE), "utf8")).trim();

  if (!SEMVER.test(version)) {
    throw new Error(`${VERSION_FILE} must contain one valid SemVer version.`);
  }

  return version;
}

// The unpublished npm bump already wrote "## agent-board@0.1.0". This release uses the
// same package name, so Tegami prepends that heading again. Drop the repeated heading
// before the version branch is committed.
function collapseDuplicateVersionHeadings(markdown: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const line of markdown.split("\n")) {
    const heading = VERSION_HEADING.exec(line)?.[1];

    if (heading !== undefined && seen.has(heading)) continue;

    if (heading !== undefined) seen.add(heading);

    kept.push(line);
  }

  return kept.join("\n").replaceAll(/\n{3,}/g, "\n\n");
}

export function releaseChangelog(): TegamiPlugin {
  return {
    name: "agent-board-release-changelog",
    enforce: "pre",
    async applyCliDraft() {
      const file = join(this.cwd, CHANGELOG_FILE);
      const current = await readFile(file, "utf8").catch(() => "");
      const next = collapseDuplicateVersionHeadings(current);

      if (next !== current) await writeFile(file, next);
    },
  };
}

export function agentBoardRelease(): TegamiPlugin {
  let pkg: AgentBoardReleasePackage | undefined;

  return {
    name: "agent-board-release",
    enforce: "post",
    async resolve() {
      pkg = new AgentBoardReleasePackage(this.cwd, await readVersion(this.cwd));
      this.graph.add(pkg);
    },
    async applyDraft(draft) {
      if (!pkg) return;
      const nextVersion = draft.getPackageDraft(pkg.id)?.bumpVersion(pkg);

      if (!nextVersion || nextVersion === pkg.version) return;
      pkg.setVersion(nextVersion);
      await writeFile(join(this.cwd, VERSION_FILE), `${nextVersion}\n`);
    },
    initPublishPlan({ plan }) {
      if (!pkg) return;
      const packagePlan = plan.packages.get(pkg.id);

      if (!packagePlan) return;
      packagePlan.git ??= {};
      packagePlan.git.tag = `v${pkg.version}`;
    },
    publishPreflight({ pkg: candidate }) {
      if (candidate instanceof AgentBoardReleasePackage) return { shouldPublish: true };
    },
    publishTasks({ plan }) {
      return plan
        .getPackagesToPublish()
        .flatMap((candidate) =>
          candidate instanceof AgentBoardReleasePackage
            ? [new AgentBoardGitTagPublishTask(candidate)]
            : [],
        );
    },
  };
}
