import {
  AccountId,
  Board,
  BoardId,
  CurrentActor,
  Directory,
  DirectoryId,
  LookupLogin,
  NoteBoard,
  OpenBoard,
  ReadFeed,
  RegisterAccount,
  RegisterAgent,
  TEAM,
  Wake,
  type Actor,
} from "@agent-board/domain";
import { AgentId } from "@agent-board/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type * as Headers from "effect/http/Headers";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { inspectPage } from "./inspectPage.ts";
import { hashPassword, passwordMatches } from "./password.ts";
import { actorFromHeaders, SessionKey, signSession } from "./SessionLive.ts";

const Signup = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  password: Schema.String,
});

const Login = Schema.Struct({ email: Schema.String, password: Schema.String });

const OpenBody = Schema.Struct({ title: Schema.String });

const RegisterBody = Schema.Struct({
  agentName: Schema.String,
  harness: Schema.String,
  boardId: Schema.optional(Schema.String),
});

const WaitBody = Schema.Struct({
  target: Schema.String,
  timeoutMs: Schema.optional(Schema.Number),
  after: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
  labelKey: Schema.optional(Schema.String),
  labelValue: Schema.optional(Schema.String),
  mention: Schema.optional(Schema.String),
  entryType: Schema.optional(Schema.String),
});

const readJson = <A>(schema: Schema.Decoder<A>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;

    return yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)));
  });

const failure = (error: { readonly _tag?: string }) =>
  HttpServerResponse.json({ _tag: error._tag ?? "Error" }, { status: 422 });

const actorFor = (headers: Headers.Headers) =>
  actorFromHeaders(headers).pipe(
    Effect.flatMap((actor) =>
      Option.match(actor, {
        onNone: () => Effect.fail(new UnauthorizedActor()),
        onSome: (value) => Effect.succeed(value),
      }),
    ),
  );

class UnauthorizedActor extends Schema.TaggedError<UnauthorizedActor>()("Unauthorized", {}) {}

const humanOf = (actor: Actor) => (actor._tag === "Human" ? actor : undefined);

export const WakeLive = Layer.succeed(Wake, {
  notify: (args: { readonly url: string; readonly body: string }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fetch(args.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: args.body,
        }),
      );

      return { status: response.status };
    }),
});

export const signup = (
  directory: Effect.Success<typeof Directory>,
  key: Effect.Success<typeof SessionKey>,
) =>
  Effect.gen(function* () {
    const body = yield* readJson(Signup);

    if (body.password.length < 8) return yield* failure({ _tag: "WeakPassword" });
    const accountId = AccountId.make(crypto.randomUUID());
    const passwordHash = yield* Effect.promise(() => hashPassword(body.password));
    const receipt = yield* directory.send(
      TEAM,
      new RegisterAccount({
        accountId,
        name: body.name,
        email: body.email,
        passwordHash,
      }),
    );
    const token = yield* signSession({
      _tag: "Human",
      accountId: receipt.reply.accountId,
      name: receipt.reply.name,
      email: receipt.reply.email,
      role: receipt.reply.role,
    }).pipe(Effect.provideService(SessionKey, key));

    const response = yield* HttpServerResponse.json({ ...receipt.reply, token });

    return yield* HttpServerResponse.setCookie(response, "board_session", token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    });
  }).pipe(Effect.catch((error: { readonly _tag?: string }) => failure(error)));

export const login = (
  directory: Effect.Success<typeof Directory>,
  key: Effect.Success<typeof SessionKey>,
) =>
  Effect.gen(function* () {
    const body = yield* readJson(Login);
    const looked = yield* directory.send(TEAM, new LookupLogin({ email: body.email }));
    const matches = yield* Effect.promise(() =>
      passwordMatches(body.password, looked.reply.passwordHash),
    );

    if (!matches) return HttpServerResponse.jsonUnsafe({ _tag: "BadCredentials" }, { status: 401 });
    const token = yield* signSession({
      _tag: "Human",
      accountId: looked.reply.accountId,
      name: looked.reply.name,
      email: looked.reply.email,
      role: looked.reply.role,
    }).pipe(Effect.provideService(SessionKey, key));

    const response = yield* HttpServerResponse.json({
      accountId: looked.reply.accountId,
      name: looked.reply.name,
      email: looked.reply.email,
      role: looked.reply.role,
      token,
    });

    return yield* HttpServerResponse.setCookie(response, "board_session", token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    });
  }).pipe(Effect.catch((error: { readonly _tag?: string }) => failure(error)));

export const openBoard = (
  boards: Effect.Success<typeof Board>,
  directory: Effect.Success<typeof Directory>,
  key: Effect.Success<typeof SessionKey>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const actor = yield* actorFor(request.headers).pipe(Effect.provideService(SessionKey, key));
    const human = humanOf(actor);

    if (human === undefined) {
      return HttpServerResponse.jsonUnsafe({ _tag: "Unauthorized" }, { status: 401 });
    }

    const body = yield* readJson(OpenBody);
    const boardId = BoardId.make(crypto.randomUUID());

    yield* boards.send(
      boardId,
      new OpenBoard({
        title: body.title,
        ownerAccountId: human.accountId,
        ownerName: human.name,
        ownerEmail: human.email,
      }),
    );
    yield* directory.send(
      TEAM,
      new NoteBoard({ boardId, title: body.title, ownerId: human.accountId }),
    );

    return yield* HttpServerResponse.json({ boardId });
  }).pipe(
    Effect.catch((error) =>
      error._tag === "Unauthorized"
        ? HttpServerResponse.json({ _tag: "Unauthorized" }, { status: 401 })
        : failure(error),
    ),
  );

export const registerAgent = (
  boards: Effect.Success<typeof Board>,
  key: Effect.Success<typeof SessionKey>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const body = yield* readJson(RegisterBody);
    const actor = yield* actorFor(request.headers).pipe(Effect.provideService(SessionKey, key));
    const boardId =
      actor._tag === "Agent"
        ? actor.boardId
        : body.boardId === undefined
          ? undefined
          : BoardId.make(body.boardId);

    if (boardId === undefined) return yield* failure({ _tag: "InvalidWork" });
    const agentId = AgentId.make(crypto.randomUUID());

    yield* boards
      .send(
        boardId,
        new RegisterAgent({ agentId, agentName: body.agentName, harness: body.harness }),
      )
      .pipe(Effect.provideService(CurrentActor, actor));
    const token = yield* signSession({
      _tag: "Agent",
      boardId,
      agentId,
      name: body.agentName,
    }).pipe(Effect.provideService(SessionKey, key));

    return yield* HttpServerResponse.json({ boardId, agentId, token });
  }).pipe(
    Effect.catch((error) =>
      error._tag === "Unauthorized"
        ? HttpServerResponse.json({ _tag: "Unauthorized" }, { status: 401 })
        : failure(error),
    ),
  );

export const waitFor = (
  boards: Effect.Success<typeof Board>,
  key: Effect.Success<typeof SessionKey>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const actor = yield* actorFor(request.headers).pipe(Effect.provideService(SessionKey, key));
    const body = yield* readJson(WaitBody);
    const timeout = Math.min(body.timeoutMs ?? 15_000, 60_000);
    const deadline = (yield* Clock.currentTimeMillis) + timeout;

    while ((yield* Clock.currentTimeMillis) < deadline) {
      const receipt = yield* boards
        .send(
          BoardId.make(body.target),
          new ReadFeed({
            ...(body.after === undefined ? {} : { after: body.after }),
            ...(body.channel === undefined ? {} : { channel: body.channel }),
            ...(body.labelKey === undefined ? {} : { labelKey: body.labelKey }),
            ...(body.labelValue === undefined ? {} : { labelValue: body.labelValue }),
            ...(body.mention === undefined ? {} : { mention: body.mention }),
            ...(body.entryType === undefined ? {} : { entryType: body.entryType }),
          }),
        )
        .pipe(Effect.provideService(CurrentActor, actor));

      if (receipt.reply.events.length > 0) {
        return yield* HttpServerResponse.json({
          event: receipt.reply.events[0],
          cursor: receipt.reply.cursor,
        });
      }

      yield* Effect.sleep("200 millis");
    }

    return HttpServerResponse.jsonUnsafe({ event: null, reason: "timeout" }, { status: 408 });
  }).pipe(
    Effect.catch((error) =>
      error._tag === "Unauthorized"
        ? HttpServerResponse.json({ _tag: "Unauthorized" }, { status: 401 })
        : failure(error),
    ),
  );

export const tail = (
  boards: Effect.Success<typeof Board>,
  key: Effect.Success<typeof SessionKey>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const actor = yield* actorFor(request.headers).pipe(Effect.provideService(SessionKey, key));
    const url = new URL(request.url, "http://localhost");
    const boardId = url.searchParams.get("board");

    if (boardId === null) return yield* failure({ _tag: "InvalidWork" });
    const encoder = new TextEncoder();
    const cursor = yield* Ref.make("");
    const channel = url.searchParams.get("channel");
    const stream = Stream.fromEffectRepeat(
      Effect.gen(function* () {
        const after = yield* Ref.get(cursor);
        const receipt = yield* boards
          .send(
            BoardId.make(boardId),
            new ReadFeed({
              ...(after === "" ? {} : { after }),
              ...(channel === null ? {} : { channel }),
            }),
          )
          .pipe(Effect.provideService(CurrentActor, actor));
        const next = receipt.reply.cursor === "" ? after : receipt.reply.cursor;

        yield* Ref.set(cursor, next);
        yield* Effect.sleep("500 millis");
        const payload = receipt.reply.events
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join("");

        return encoder.encode(payload.length === 0 ? ": keepalive\n\n" : payload);
      }),
    );

    return HttpServerResponse.stream(stream, { contentType: "text/event-stream" });
  }).pipe(
    Effect.catch((error) =>
      error._tag === "Unauthorized"
        ? HttpServerResponse.json({ _tag: "Unauthorized" }, { status: 401 })
        : failure(error),
    ),
  );

export const inspect = () =>
  HttpServerResponse.text(inspectPage, { contentType: "text/html; charset=utf-8" });

void DirectoryId;
