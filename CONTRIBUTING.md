# Contributing

## Setup

Install Node.js 24.15.0 and nub 0.10.0, then:

```sh
nub install
```

`nub install` installs the pre-push hook. The hook runs typecheck, lint, and format. Skip it once with `git push --no-verify` or `LEFTHOOK=0`.

## Branch and pull request flow

Branch from `master`. Open the pull request as a draft. Run lint, typecheck, and tests locally before each push. Mark the pull request ready when the work is done.

```sh
nub run typecheck
nub run lint
nub run format
nub run test
```

User-facing changes include a note in `.tegami/`.

## Code style

TypeScript is checked with tsrs. Formatting is oxfmt. Linting is oxlint with the shared SolZero rules and Effect rules on the domain, Worker, and CLI. Fix findings instead of disabling a rule. A scoped override needs a concrete reason that the rule is wrong for that code.

The domain model is the source of the HTTP API, the MCP server, and the CLI. Add a command or a view on the model, and expose it from `BoardApi`, instead of writing a second handler.

## Tests

End-to-end tests live in `tests/**/*.e2e.ts` and run against a local `alchemy dev` process. Feature notes in `features/` name the tests that cover them.
