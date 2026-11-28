import BoardWorker from "@agent-board/server";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

/**
 * One stack for local dev and for an alchemy.new deploy.
 * Alchemy state stays on disk (`localState`) so `alchemy dev` does not create
 * a Cloudflare state-store Worker. Domain data lives in Durable Objects.
 * `BETTER_AUTH_SECRET` and, when unset, the owner password are
 * `Alchemy.makeRandom` outputs bound into the Worker. They are not literals
 * in this file.
 */
export default Alchemy.Stack(
  "AgentBoard",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const signingSecret = yield* Alchemy.makeRandom("better-auth-secret", { bytes: 32 });

    const configuredPassword = yield* Config.String("BOARD_OWNER_PASSWORD").pipe(
      Config.withDefault(""),
    );

    const suppliedPassword = Option.liftPredicate(
      configuredPassword.trim(),
      (password) => password.length > 0,
    );

    const ownerPassword = yield* Option.match(suppliedPassword, {
      onSome: (password) => Effect.succeed(Redacted.make(password)),
      onNone: () => Alchemy.makeRandom("owner-password", { bytes: 32 }),
    });

    const worker = yield* BoardWorker;

    yield* worker.bind("board-secrets", {
      env: {
        BETTER_AUTH_SECRET: signingSecret,
        BOARD_OWNER_PASSWORD: ownerPassword,
      },
    });

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
