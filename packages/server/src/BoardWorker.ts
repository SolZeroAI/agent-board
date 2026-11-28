import {
  AgentBoard,
  AgentBoardPolicies,
  Board,
  BoardApi,
  Directory,
  RegisterAccount,
  TEAM,
} from "@agent-board/domain";
import { AccountId } from "@agent-board/domain";
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import * as DomainCloudflare from "@alchemy.run/cloudflare/Domain";
import * as DomainHttp from "@alchemy.run/domain/Http";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { RuntimeContext } from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Path from "effect/Path";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import { AuthLive, bindSignupAdmission, BoardAuth, seedOwner } from "./Auth.ts";
import {
  createInvite,
  login,
  mcp,
  openBoard,
  registerAgent,
  revokeAgent,
  signup,
  tail,
  waitFor,
  WakeLive,
} from "./routes.ts";
import { SessionLive } from "./SessionLive.ts";

const AuthDb = Cloudflare.D1.Database("AuthDb");

const BoardLive = SessionLive.pipe(
  Layer.provideMerge(AgentBoard.layer(AgentBoardPolicies)),
  Layer.provide(WakeLive),
  Layer.provide(DomainCloudflare.layerDurableObjects()),
);

const httpSurface = DomainHttp.toHttpApi(BoardApi);
const httpApi = httpSurface.api.prefix("/api");

/**
 * The board Worker. Durable Objects come from the domain platform.
 * `/api` is the plain HTTP API, `/mcp` is the MCP server, and other
 * paths are the domain RPC protocol the CLI uses.
 */
export default class BoardWorker extends Cloudflare.Worker<BoardWorker>()(
  "agent-board",
  {
    main: import.meta.url,
    compatibility: { flags: ["nodejs_compat"] },
    dev: { host: "127.0.0.1", port: 8788, strictPort: true },
    workersDev: true,
  },
  Effect.gen(function* () {
    const api = yield* BoardApi;
    const boards = yield* Board;
    const directory = yield* Directory;
    const auth = yield* BoardAuth;

    bindSignupAdmission((input) =>
      Effect.runPromise(
        directory
          .send(
            TEAM,
            new RegisterAccount({
              accountId: AccountId.make(input.userId),
              name: input.name,
              email: input.email,
              ...(input.invite === undefined ? {} : { invite: input.invite }),
              ...(input.seed ? { seed: true } : {}),
            }),
          )
          .pipe(
            Effect.map((receipt) => receipt.reply.role),
            Effect.mapError((error) => new Error(error._tag)),
          ),
      ),
    );

    const ownerEmail = yield* Config.String("BOARD_OWNER_EMAIL").pipe(
      Config.withDefault("owner@agent-board.test"),
    );
    const ownerPassword = yield* Config.String("BOARD_OWNER_PASSWORD");

    const handleHttp = yield* HttpApiBuilder.layer(httpApi, { openapiPath: "/openapi.json" }).pipe(
      Layer.provide(httpSurface.layerFor(httpApi)),
      Layer.provide(BoardLive),
      Layer.provide(HttpPlatform.layer),
      Layer.provide(Etag.layerWeak),
      Layer.provide(FileSystem.layerNoop({})),
      Layer.provide(Path.layer),
      HttpRouter.toHttpEffect,
      Effect.scoped,
    );

    return {
      fetch: Effect.gen(function* () {
        yield* seedOwner(auth, {
          email: ownerEmail,
          name: "Owner",
          password: ownerPassword,
        }).pipe(Effect.orDie);
        const request = yield* HttpServerRequest;
        const path = new URL(request.url, "http://localhost").pathname;

        if (request.method === "GET" && (path === "/" || path === "/health")) {
          return HttpServerResponse.jsonUnsafe({ ok: true });
        }

        if (request.method === "POST" && path === "/accounts") return yield* signup(auth);

        if (request.method === "POST" && path === "/login") return yield* login(auth);

        if (request.method === "POST" && path === "/invites")
          return yield* createInvite(directory, auth);

        if (request.method === "POST" && path === "/boards")
          return yield* openBoard(boards, directory, auth);

        if (request.method === "POST" && path === "/agents")
          return yield* registerAgent(boards, auth);

        if (request.method === "POST" && path === "/agents/revoke")
          return yield* revokeAgent(boards, auth);

        if (request.method === "POST" && path === "/wait") return yield* waitFor(boards, auth);

        if (request.method === "GET" && path === "/tail") return yield* tail(boards, auth);

        if (path === "/api/auth" || path.startsWith("/api/auth/")) return yield* auth.fetch;

        if (path === "/mcp" || path.startsWith("/mcp/")) return yield* mcp(boards, auth);

        if (path === "/api" || path.startsWith("/api/")) return yield* handleHttp;

        return yield* api.fetch;
      }),
    };
  }).pipe(
    Effect.provide(BoardLive),
    Effect.provide(AuthLive),
    Effect.provide(CloudflareD1(AuthDb)),
    Effect.provide(RuntimeContext.phantom),
  ),
) {}
