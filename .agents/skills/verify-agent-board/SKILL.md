# Verify Agent Board

Run the local end-to-end suite and collect evidence. Do not deploy and do not print secrets.

## Launch

From the repository root, with Node 24 and nub 0.10.0:

```sh
nub install
nub run test
```

`nub run test` starts `alchemy dev` on `http://127.0.0.1:8787` and runs `tests/**/*.e2e.ts`.

## Doctor

- `GET http://127.0.0.1:8787/health` returns `{ "ok": true }` while the suite is running, or after `nub run dev`.
- `CLOUDFLARE_ACCOUNT_ID` and `CF_AI_GATEWAY_E2E_TOKEN` must be set for the decision filter. `CF_AI_GATEWAY_E2E_ID` defaults to `default`. Do not print the values.
- If the filter cannot reach the gateway, the suite runs every test and records a warning.

## Drive

```sh
nub run test:e2e:live
nub run test:e2e:cache-strict
```

Use `nub run test:e2e:list` to see the collected tests. Feature notes in `features/` name the test that covers each flow.

## Evidence

Keep logs under `.e2e/` locally. Copy the run log and `.e2e` reports you need to share into the cloud-agent artifact directory. Do not commit them. Commit `.e2e/cache/` only when an action replay changed.
