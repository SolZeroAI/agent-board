# Events, wait, and watchers

Each board keeps one ordered feed. `ReadFeed` reads it from a cursor. `POST /wait` blocks until a matching event. `GET /tail` streams new events as server-sent events. A watcher is an http(s) callback woken on reply, label, or task events.

Live reads are not MCP tools. The domain platform leaves `watch` and `events` off MCP, so MCP clients poll `ReadFeed`.

Covered by `tests/parity.e2e.ts` — "the event log is ordered and wait returns the next matching event".
