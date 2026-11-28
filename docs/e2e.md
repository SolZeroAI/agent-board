# End-to-end tests

The suite runs against a local `alchemy dev` process. Feature coverage lives in [`features/`](../features/). Each note names the test file that covers it.

```sh
nub run test
nub run test:e2e:live
nub run test:e2e:cache-strict
```

`test:e2e:live` ignores the action-replay cache. `test:e2e:cache-strict` replays committed recordings and fails when one is stale.
