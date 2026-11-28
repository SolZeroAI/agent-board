# End-to-end tests

The suite runs against a local `alchemy dev` process. Feature coverage lives in [`features/`](../features/). Each note names the test file that covers it.

```sh
nub run test
nub run test:e2e:live
nub run test:e2e:cache-strict
```

`test:e2e:live` ignores the action-replay cache. `test:e2e:cache-strict` replays committed recordings and fails when one is stale.

`e2e.config.ts` wraps `decisionFilter` in `ignoreUnobservedChanges` from `scripts/e2e/filters.ts`. That file is identical in every SolZero repository. Changes only to `.agents/`, `.claude/`, `skills-lock.json`, `AGENTS.md`, `CLAUDE.md`, `.tegami/`, `VERSION`, and `CHANGELOG.md` are removed before the decision filter reads the diff, so a skills refresh or a version pull request runs no tests. A change to `e2e.config.ts` or the lockfile keeps every test.

## Replay

Action replay recordings in `.e2e/cache` are committed, and CI replays them with `--strict-cache`. A stale recording fails the run. Before you mark a pull request ready for review, re-record if you changed an `agent.act` step or the UI one drives:

```sh
gh workflow run validate.yml --ref <branch> -f e2e_record=true
```

Wait for that run to pass, and pull the recordings commit it pushes to your branch. The `Commit recorded action replays` job commits changed files under `.e2e/cache` and pushes them with the release app token, which starts pull request CI. The job does not run on the default branch. Set `-f e2e_commit=false` to upload the `agent-board-e2e-replays-<run>-<attempt>` artifact and skip the commit.

Without CI access, run `nub run test` locally and commit the changed recordings. Do not commit other `.e2e/` output.
