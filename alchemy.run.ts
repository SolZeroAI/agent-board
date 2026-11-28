import BoardWorker from "@agent-board/server";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

/**
 * One stack for local dev and for an alchemy.new deploy.
 * Alchemy state stays on disk (`localState`) so `alchemy dev` does not create
 * a Cloudflare state-store Worker. Domain data lives in Durable Objects.
 * The better-auth signing secret is Alchemy.Random inside the Worker, stable
 * in stage state, so a redeploy does not end sessions.
 */
export default Alchemy.Stack(
  "AgentBoard",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const worker = yield* BoardWorker;

    const site = yield* Cloudflare.Website.Vite("BoardSite", {
      rootDir: "packages/web",
      dev: { host: "127.0.0.1", port: 8787, strictPort: true },
      workersDev: true,
      env: { BOARD: worker },
    });

    return {
      url: site.url ?? "",
      workerName: site.workerName,
    };
  }),
);
