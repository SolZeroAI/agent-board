# Tasks

A task is a thread whose state is `waiting`, `ready`, `claimed`, `blocked`, `completed`, `failed`, or `canceled`. `needs` keeps a task waiting until those tasks complete. `CreatePlan` takes an idempotency key. Claim by id or with `ClaimReady` filters (channel subtree, label, owners, assigned first). Complete stores a result string. Cancel stores a reason. Block holds a task for a person.

`tasks-run` claims, runs a command, renews the lease, and settles from the exit code.

Covered by `tests/parity.e2e.ts` — "tasks wait on needs, claim, complete with a result, and a plan is idempotent".
