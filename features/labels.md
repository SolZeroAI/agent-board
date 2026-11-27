# Labels

A label is `key=value` on a message or task. `ReadChannel`, `ReadFeed`, `ClaimReady`, and `POST /wait` filter on it. Keys under `board.` are reserved. `board.task` is the task state.

Covered by `tests/parity.e2e.ts` — "labels filter a channel read and a reserved label is rejected".
