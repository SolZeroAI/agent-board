# Releasing Agent Board

Agent Board ships one release: the `agent-board` package in the
[alchemy.new](https://alchemy.new) registry, under the `solzero` org. A
deployer picks a version on alchemy.new and deploys it to their own Cloudflare
account.

[Tegami](https://tegami.fuma-nama.dev) tracks the release as
`release:agent-board`. It writes the next version to the root `VERSION`
file, prepends `CHANGELOG.md`, and tags `v<version>`. The release job reads
that same `VERSION` file. `package.json` is not the release version. The
workspace packages are private and are not published to npm.

## Version policy

`VERSION` is `0.0.0` until the first registry publish. Nothing is published
yet, and no `v*` tag exists, so `VERSION` stays `0.0.0`. Follow Semantic
Versioning:

- `patch` for a compatible fix
- `minor` for a backward-compatible feature
- `major` for a breaking change

Do not bump the version in a feature pull request. Tegami writes the next
version in the Version Packages pull request. When several pending entries
name the same package, Tegami keeps the highest change. Two `minor` entries
still produce one minor bump.

## Add a release entry

Every pull request with an observable effect on a user, an administrator, or
a deployment operator must add a Markdown file under `.tegami/`. Use a clear
file name such as `.tegami/2026-11-28-sign-in-deploy-and-setup.md`.

```md
---
packages:
  "release:agent-board": minor
---

## Short title

What changed, in plain language, for the person who deploys or uses the board.
```

Target only `release:agent-board`. Choose `patch`, `minor`, or `major`
from the version policy. Write the note for the people who deploy and run
Agent Board.
Name any required action. Tegami adds pull request and contributor links when
it builds the GitHub Release.

`nub run tegami` creates an entry, but it asks questions in the terminal. It
does not accept the note as a flag. Write the file directly when you cannot
answer those prompts. The pull request preview workflow posts the combined
version and release-note preview.

A change with no observable effect can use the `release:none` label after the
pull request explains why it needs no entry.

## Automated release flow

1. Merge a feature pull request with its pending `.tegami/` entries.
2. Wait for `Validate` to pass on `master`. The `Release` workflow then runs
   `nub run tegami version` for a normal merge, or `nub run tegami ci` for a
   Version Packages commit. It opens or updates `tegami/version-packages`
   with the solzero-bot GitHub App token (`RELEASE_APP_CLIENT_ID` and
   `RELEASE_APP_PRIVATE_KEY`). The job `GITHUB_TOKEN` stays read-only.
3. Review the version pull request. It updates `VERSION`, prepends
   `CHANGELOG.md`, consumes the pending entries, and writes
   `.tegami/publish-lock.yaml`.
4. Squash-merge the Version Packages pull request. The squash commit title is
   the pull request title, `Version Packages`. The squash commit author is
   solzero-bot (`341870119+solzero-bot[bot]@users.noreply.github.com`). After
   validation, the release workflow tags `v<version>` from `VERSION` and
   creates the GitHub Release. The publish job then builds the stack, prunes
   development dependencies, and publishes that version to alchemy.new.

Version Packages pull requests are squash-merged. That squash merge is the
publish to alchemy.new. Do not edit `VERSION`, `CHANGELOG.md`, or
`.tegami/publish-lock.yaml` on a feature branch. Do not deploy, tag, or upload
a package by hand.

This workflow versions and publishes the registry package. It does not deploy
production Cloudflare infrastructure.

## Repository settings

The `release:none` label exists for pull requests that have no user-visible
release note. Its description is "No observable effect; no Tegami release
entry needed".

Only the publish job requests `id-token: write`, and it runs in the
`alchemy-new` environment. The registry host is `https://alchemy.new`. The
OIDC audience is `https://alchemy.new/registry/publish`. The token exchange is
`POST https://alchemy.new/v1/oidc/github/exchange`.

## Failure recovery

Re-run the failed `Release` workflow after a network, registry, or GitHub API
failure. Tegami checks existing tags and GitHub releases, so the retry
continues the same version without duplicating work. If only the publish job
failed, re-run that job.

If a released change has a defect, fix it in a new pull request and add a new
release entry. Keep an existing release tag at its original commit. Never
delete or move a published release tag.
