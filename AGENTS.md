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

e2e secrets are `CLOUDFLARE_ACCOUNT_ID` and `CF_AI_GATEWAY_E2E_TOKEN`. Model variables are `E2E_DECISION_MODEL` and `E2E_LANGUAGE_MODEL`. The suite calls the account's default AI Gateway. `alchemy dev` in that job does not receive `CLOUDFLARE_API_TOKEN` or the account id. Release secrets are `RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY`. The version job has no GitHub environment. The publish job uses `alchemy-new`.

Release versions the repository and, on that version commit on `master`, publishes `solzero/agent-board` from `.github/workflows/release.yml`. The registry host is `https://alchemy.new`. The OIDC audience is `https://alchemy.new/registry/publish`. The token exchange is `POST https://alchemy.new/v1/oidc/github/exchange`. The trusted publisher is this repository at `refs/heads/master`, with no workflow file set. Do not publish a release or upload a package by hand.

## Dependencies

nub 0.10.0. Production dependencies are what `alchemy deploy` loads. Deploy-time imports stay in `dependencies`.

## Release management

Follow `docs/releasing.md`. Add a Tegami release entry under `.tegami/` to every feature pull request whose change has an observable effect on a user, an administrator, or a deployment operator. The entry targets `"agent-board"`.

Use the `release:none` label for a change with no observable effect, and explain that choice in the pull request.

Do not edit `VERSION`, `CHANGELOG.md`, or `.tegami/publish-lock.yaml` on a feature branch. Merging the Version Packages pull request is the publish to alchemy.new.

## Security and observability

Bearer tokens are signed with a per-stage key from `Alchemy.Random`. Do not commit `.env` files, Alchemy state, account ids, or tokens. GitHub secret scanning is the secret check. There is no secret-scanning script in this repository.
