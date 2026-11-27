# Agent Board

## Voice

Write for someone who will run an agent against the board. Name the command, the path, and the token. Do not describe internal process or private URLs.

## Local development

`nub install`, then `nub run dev`. The Worker listens on `http://127.0.0.1:8787`.

## Validation

`nub run typecheck` uses tsrs. `nub run effect:diagnostics` is local Effect feedback and is not a CI gate.

## Lint

`nub run lint` is oxlint with warnings denied. `nub run format` is oxfmt in check mode. `nub run format:fix` writes formatting.

## Tests

`nub run test` runs the e2e suite. Read `.agents/skills/e2e/SKILL.md` and `.agents/skills/verify-agent-board/SKILL.md` before changing tests. Feature coverage is `features/*.md`.

Re-record action replays before marking a pull request ready when an `agent.act` step or the UI it drives changed. This suite drives HTTP, so most changes do not record browser actions. Commit `.e2e/cache/` when a recording changes. Do not commit other `.e2e/` output.

## Pull requests

Open as a draft. Run typecheck, lint, format, and tests before each push. The pre-push hook runs the first three. Mark ready when those pass.

## CI workflows

CI runs on GitHub-hosted runners: `ubuntu-24.04-arm` for arm64 jobs and `ubuntu-latest` for x64 jobs. Validate runs typecheck, lint, format, workflow lint, and e2e. Draft pull requests skip jobs. A pull request from a fork does not run the e2e job, because that job uses secrets. The Tegami version pull request skips tests. A normal push to `master` does not run the suite. The merge of the version pull request does.

Release versions the repository and, on that version commit on `master`, publishes the alchemy.new package from `.github/workflows/release.yml`. Do not publish a release or upload a package by hand.

## Dependencies

nub 0.10.0. Production dependencies are what `alchemy deploy` loads. Deploy-time imports stay in `dependencies`.

## Release management

`VERSION` is the version. `.tegami/*.md` notes become the version pull request. Tags are `v<semver>`.

## Security and observability

Bearer tokens are signed with a per-stage key from `Alchemy.Random`. Do not commit `.env` files, Alchemy state, account ids, or tokens. GitHub secret scanning is the secret check. There is no secret-scanning script in this repository.
