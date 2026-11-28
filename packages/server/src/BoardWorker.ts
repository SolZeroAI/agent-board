import {
  AgentBoard,
  AgentBoardPolicies,
  AgentId,
  Board,
  BoardApi,
  BoardId,
  CurrentActor,
  OpenBoard,
  RegisterAgent,
  Unauthorized,
} from "@agent-board/domain";
import * as DomainAi from "@alchemy.run/domain/Ai";
import * as DomainCloudflare from "@alchemy.run/cloudflare/Domain";
import * as DomainHttp from "@alchemy.run/domain/Http";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Ai from "effect/ai";
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
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  actorFromHeaders,
  SessionKey,
  SessionKeyLive,
  SessionLive,
  signSession,
} from "./SessionLive.ts";

const BoardLive = SessionLive.pipe(
  Layer.provideMerge(SessionKeyLive),
  Layer.provideMerge(AgentBoard.layer(AgentBoardPolicies)),
  Layer.provide(DomainCloudflare.layerDurableObjects()),
);

const OpenBody = Schema.Struct({
  title: Schema.String,
  agentName: Schema.String,
  harness: Schema.String,
});

const RegisterBody = Schema.Struct({
  agentName: Schema.String,
  harness: Schema.String,
});

const httpSurface = DomainHttp.toHttpApi(BoardApi);
const httpApi = httpSurface.api.prefix("/api");

const readJson = <A>(schema: Schema.Decoder<A>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;

    return yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)));
  });

const failure = (error: { readonly _tag?: string }) =>
  HttpServerResponse.json({ _tag: error._tag ?? "Error" }, { status: 422 });

const openBoard = (boards: Effect.Success<typeof Board>, key: Effect.Success<typeof SessionKey>) =>
  Effect.gen(function* () {
    const body = yield* readJson(OpenBody);
    const boardId = BoardId.make(crypto.randomUUID());
    const agentId = AgentId.make(crypto.randomUUID());

    yield* boards.send(
      boardId,
      new OpenBoard({
        title: body.title,
        agentId,
        agentName: body.agentName,
        harness: body.harness,
      }),
    );

    const token = yield* signSession({ boardId, agentId }).pipe(
      Effect.provideService(SessionKey, key),
    );

    return yield* HttpServerResponse.json({ boardId, agentId, token });
  }).pipe(Effect.catch((error) => failure(error)));

const registerAgent = (
  boards: Effect.Success<typeof Board>,
  key: Effect.Success<typeof SessionKey>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const body = yield* readJson(RegisterBody);

    const actor = yield* actorFromHeaders(request.headers).pipe(
      Effect.provideService(SessionKey, key),
    );

    if (Option.isNone(actor)) {
      return yield* HttpServerResponse.json(new Unauthorized(), { status: 401 });
    }

    const agentId = AgentId.make(crypto.randomUUID());

    yield* boards
      .send(
        actor.value.boardId,
        new RegisterAgent({
          agentId,
          agentName: body.agentName,
          harness: body.harness,
        }),
      )
      .pipe(Effect.provideService(CurrentActor, actor.value));

    const token = yield* signSession({ boardId: actor.value.boardId, agentId }).pipe(
      Effect.provideService(SessionKey, key),
    );

    return yield* HttpServerResponse.json({
      boardId: actor.value.boardId,
      agentId,
      token,
    });
  }).pipe(Effect.catch((error) => failure(error)));

/**
 * The board Worker. Durable Objects come from the domain platform.
 * `/api` is the plain HTTP API, `/mcp` is the MCP server, and other
 * paths are the domain RPC protocol the CLI uses.
 */
export default class BoardWorker extends Cloudflare.Worker<BoardWorker>()(
  "agent-board",
  {
    main: import.meta.url,
    dev: { host: "127.0.0.1", port: 8787, strictPort: true },
  },
  Effect.gen(function* () {
    const api = yield* BoardApi;
    const boards = yield* Board;
    const key = yield* SessionKey;

    const handleMcp = yield* DomainAi.toMcp(BoardApi).pipe(
      Layer.provide(
        Ai.McpServer.layerHttpRequestScoped({
          name: "agent-board",
          version: "0.0.0",
          path: "/mcp",
          protocols: [Ai.McpProtocol.v2026_07_28],
        }),
      ),
      Layer.provide(BoardLive),
      HttpRouter.toHttpEffect,
      Effect.scoped,
      Effect.orDie,
    );

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
        const request = yield* HttpServerRequest;
        const path = new URL(request.url, "http://localhost").pathname;

        if (request.method === "GET" && (path === "/" || path === "/health")) {
          return HttpServerResponse.jsonUnsafe({ ok: true });
        }

        if (request.method === "POST" && path === "/boards") return yield* openBoard(boards, key);

        if (request.method === "POST" && path === "/agents")
          return yield* registerAgent(boards, key);

        if (path === "/mcp" || path.startsWith("/mcp/")) return yield* handleMcp;

        if (path === "/api" || path.startsWith("/api/")) return yield* handleHttp;

        return yield* api.fetch;
      }),
    };
  }).pipe(Effect.provide(BoardLive)),
) {}
