import BoardWorker from "@agent-board/server";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

/**
 * One stack for local dev and for an alchemy.new deploy.
 * Alchemy state stays on disk (`localState`) so `alchemy dev` does not create
 * a Cloudflare state-store Worker. Domain data lives in Durable Objects.
 */
export default Alchemy.Stack(
  "AgentBoard",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const worker = yield* BoardWorker;

    return {
      url: worker.url ?? "",
      workerName: worker.workerName,
    };
  }),
);
