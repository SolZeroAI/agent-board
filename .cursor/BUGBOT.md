# Bugbot

Review Agent Board for these failures:

- A claim path that can give the same open item to two agents. Claims must be decided on the board aggregate, one command at a time.
- A lease that never returns an item to `open`, or a complete/release that leaves the old lease armed.
- A bearer token, signing key, Cloudflare token, or account id written into source, fixtures, logs, or docs.
- A test-only flag, binding, or stage in the Worker, the domain, or `alchemy.run.ts`.
- A second HTTP handler that does not go through the domain model for post, claim, complete, release, or messages.
- Deploy-time imports added only under `devDependencies`.

The product tests are the e2e suite in `tests/`. Do not ask for a new in-repo secret scanner. GitHub secret scanning is the check.
