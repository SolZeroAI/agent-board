import {
  Board,
  BoardId,
  CreateInvite,
  CurrentActor,
  Directory,
  DirectoryId,
  NoteBoard,
  OpenBoard,
  PostMessage,
  ReadChannels,
  ReadFeed,
  RegisterAgent,
  RevokeAgent,
  TEAM,
  Wake,
  type Actor,
} from "@agent-board/domain";
import { AgentId } from "@agent-board/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type * as Headers from "effect/http/Headers";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { AGENT_SESSION_MS, type BoardAuthService, createInvitedAccount } from "./Auth.ts";
import { resolveActor } from "./SessionLive.ts";

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
  profile: Schema.optional(Schema.String),
});

const RevokeBody = Schema.Struct({
  boardId: Schema.String,
  agentId: Schema.String,
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

const actorFor = (auth: BoardAuthService, headers: Headers.Headers) => resolveActor(auth, headers);

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

interface AuthContext {
  readonly internalAdapter: {
    readonly createSession: (
      userId: string,
      dontRememberMe: boolean,
      override: Record<string, unknown>,
      overrideAll: boolean,
    ) => Promise<{ readonly id: string; readonly token: string }>;
    readonly deleteSession: (token: string) => Promise<void>;
  };
  readonly adapter: {
    readonly findOne: (args: {
      readonly model: string;
      readonly where: ReadonlyArray<{ readonly field: string; readonly value: string }>;
    }) => Promise<{ readonly token?: string } | null>;
  };
}

const contextOf = (auth: BoardAuthService) =>
  Effect.gen(function* () {
    const instance = yield* auth.auth;

    return yield* Effect.promise(() => instance.$context as unknown as Promise<AuthContext>);
  });

const sessionCookie = (response: HttpServerResponse.HttpServerResponse, token: string) =>
  HttpServerResponse.setCookie(response, "board_session", token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
  });

const accountFrom = (value: {
  readonly token: string | null;
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly role?: string;
  };
}) => ({
  accountId: value.user.id,
  name: value.user.name,
  email: value.user.email,
  role: value.user.role ?? "member",
  token: value.token ?? "",
});

const authFailure = (error: {
  readonly _tag?: string;
  readonly statusCode?: number;
  readonly body?: { readonly message?: string };
}) => {
  if (error._tag === "BetterAuthApiError" && error.statusCode === 403) {
    return failure({ _tag: "InviteRequired" });
  }

  if (error._tag === "BetterAuthApiError" && error.statusCode === 429) {
    return HttpServerResponse.json({ _tag: "RateLimited" }, { status: 429 });
  }

  if (
    error._tag === "BetterAuthApiError" &&
    (error.statusCode === 401 || error.statusCode === 400)
  ) {
    return HttpServerResponse.json({ _tag: "BadCredentials" }, { status: 401 });
  }

  return failure(error);
};

export const signup = (auth: BoardAuthService) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const body = yield* readJson(Signup);

    if (body.password.length < 8) return yield* failure({ _tag: "WeakPassword" });

    const invite = request.headers["x-board-invite"];

    if (invite === undefined || invite === "") {
      return HttpServerResponse.jsonUnsafe({ _tag: "SignUpDisabled" }, { status: 403 });
    }

    const account = yield* createInvitedAccount(auth, {
      name: body.name,
      email: body.email,
      password: body.password,
      invite,
    });
    const response = yield* HttpServerResponse.json(account);

    return yield* sessionCookie(response, account.token);
  }).pipe(
    Effect.catch((error) => {
      const message = error instanceof Error ? error.message : "";

      if (message.includes("Invite")) return failure({ _tag: "InviteRequired" });

      return failure(error);
    }),
  );

export const login = (auth: BoardAuthService) =>
  Effect.gen(function* () {
    const body = yield* readJson(Login);
    const signed = yield* auth.api.signInEmail({
      body: { email: body.email, password: body.password },
    });
    const account = accountFrom(signed);
    const response = yield* HttpServerResponse.json(account);

    return yield* sessionCookie(response, account.token);
  }).pipe(Effect.catch((error) => authFailure(error)));

export const openBoard = (
  boards: Effect.Success<typeof Board>,
  directory: Effect.Success<typeof Directory>,
  auth: BoardAuthService,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const actor = yield* actorFor(auth, request.headers);
    const human = humanOf(actor);

    if (human === undefined) {
      return HttpServerResponse.jsonUnsafe({ _tag: "Unauthorized" }, { status: 401 });
    }

    const body = yield* readJson(OpenBody);
    const boardId = BoardId.make(crypto.randomUUID());

    yield* boards
      .send(
        boardId,
        new OpenBoard({
          title: body.title,
          ownerAccountId: human.accountId,
          ownerName: human.name,
          ownerEmail: human.email,
        }),
      )
      .pipe(Effect.provideService(CurrentActor, actor));
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

export const registerAgent = (boards: Effect.Success<typeof Board>, auth: BoardAuthService) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const body = yield* readJson(RegisterBody);
    const actor = yield* actorFor(auth, request.headers);

    if (actor._tag !== "Human") return yield* failure({ _tag: "Forbidden" });

    const boardId = body.boardId === undefined ? undefined : BoardId.make(body.boardId);

    if (boardId === undefined) return yield* failure({ _tag: "InvalidWork" });

    const agentId = AgentId.make(crypto.randomUUID());
    const context = yield* contextOf(auth);
    const created = yield* Effect.promise(() =>
      context.internalAdapter.createSession(
        actor.accountId,
        false,
        {
          expiresAt: new Date(Date.now() + AGENT_SESSION_MS),
          kind: "agent",
          boardId,
          agentId,
          agentName: body.agentName,
          profile: body.profile ?? "",
        },
        true,
      ),
    );

    const registered = yield* boards
      .send(
        boardId,
        new RegisterAgent({
          agentId,
          agentName: body.agentName,
          harness: body.harness,
          sessionId: created.id,
          ...(body.profile === undefined ? {} : { profile: body.profile }),
        }),
      )
      .pipe(
        Effect.provideService(CurrentActor, actor),
        Effect.tapError(() =>
          Effect.promise(() => context.internalAdapter.deleteSession(created.token)),
        ),
      );

    return yield* HttpServerResponse.json({
      boardId,
      agentId: registered.reply.agentId,
      token: created.token,
    });
  }).pipe(
    Effect.catch((error) =>
      error._tag === "Unauthorized"
        ? HttpServerResponse.json({ _tag: "Unauthorized" }, { status: 401 })
        : failure(error),
    ),
  );

export const revokeAgent = (boards: Effect.Success<typeof Board>, auth: BoardAuthService) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const body = yield* readJson(RevokeBody);
    const actor = yield* actorFor(auth, request.headers);
    const receipt = yield* boards
      .send(BoardId.make(body.boardId), new RevokeAgent({ agentId: AgentId.make(body.agentId) }))
      .pipe(Effect.provideService(CurrentActor, actor));
    const context = yield* contextOf(auth);
    const row = yield* Effect.promise(() =>
      context.adapter.findOne({
        model: "session",
        where: [{ field: "id", value: receipt.reply.sessionId }],
      }),
    );

    if (row?.token !== undefined) {
      yield* Effect.promise(() => context.internalAdapter.deleteSession(row.token!));
    }

    return yield* HttpServerResponse.json({ agentId: receipt.reply.agentId });
  }).pipe(
    Effect.catch((error) =>
      error._tag === "Unauthorized"
        ? HttpServerResponse.json({ _tag: "Unauthorized" }, { status: 401 })
        : failure(error),
    ),
  );

export const createInvite = (directory: Effect.Success<typeof Directory>, auth: BoardAuthService) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const actor = yield* actorFor(auth, request.headers);
    const code = crypto.randomUUID();
    const receipt = yield* directory
      .send(TEAM, new CreateInvite({ code }))
      .pipe(Effect.provideService(CurrentActor, actor));

    return yield* HttpServerResponse.json({ code: receipt.reply.code });
  }).pipe(
    Effect.catch((error) =>
      error._tag === "Unauthorized"
        ? HttpServerResponse.json({ _tag: "Unauthorized" }, { status: 401 })
        : failure(error),
    ),
  );

export const waitFor = (boards: Effect.Success<typeof Board>, auth: BoardAuthService) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const actor = yield* actorFor(auth, request.headers);
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

export const tail = (boards: Effect.Success<typeof Board>, auth: BoardAuthService) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const actor = yield* actorFor(auth, request.headers);
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

const rpcResult = (id: unknown, result: unknown) =>
  HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id, result });

const rpcError = (id: unknown, code: number, message: string) =>
  HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id, error: { code, message } });

const toolResult = (id: unknown, text: string, isError = false) =>
  rpcResult(id, { content: [{ type: "text", text }], isError });

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

/**
 * Streamable HTTP MCP for the agent credential shown in the setup prompt.
 * The credential is already bound to one board, so the tools take a channel
 * and a body rather than a separate target.
 */
export const mcp = (boards: Effect.Success<typeof Board>, auth: BoardAuthService) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const parsed = yield* request.json.pipe(
      Effect.map((value) => asRecord(value)),
      Effect.option,
    );
    const message = parsed._tag === "Some" ? parsed.value : undefined;

    if (message === undefined) return rpcError(null, -32700, "Parse error");

    const id = message.id ?? null;
    const method = typeof message.method === "string" ? message.method : "";
    const params = asRecord(message.params) ?? {};

    if (method === "initialize") {
      const response = rpcResult(id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "agent-board", version: "0.0.0" },
      });

      return HttpServerResponse.setHeader(response, "mcp-session-id", crypto.randomUUID());
    }

    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return HttpServerResponse.empty({ status: 202 });
    }

    const actor = yield* actorFor(auth, request.headers).pipe(Effect.option);
    const agent = actor._tag === "Some" && actor.value._tag === "Agent" ? actor.value : undefined;

    if (agent === undefined) return rpcError(id, -32001, "An agent credential is required");

    if (method === "tools/list") {
      return rpcResult(id, {
        tools: [
          {
            name: "list_channels",
            description: "List the channels on this agent's board.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "post_message",
            description: "Post a message to a channel. It shows up in the board feed.",
            inputSchema: {
              type: "object",
              properties: {
                channel: { type: "string" },
                body: { type: "string" },
              },
              required: ["channel", "body"],
            },
          },
        ],
      });
    }

    if (method !== "tools/call") return rpcError(id, -32601, `Method not found: ${method}`);

    const name = typeof params.name === "string" ? params.name : "";
    const args = asRecord(params.arguments) ?? {};
    const input = asRecord(args.input) ?? args;
    const channel = typeof input.channel === "string" ? input.channel : "dev";
    const body = typeof input.body === "string" ? input.body : "";

    if (name === "list_channels" || name === "BoardApi_ReadChannels_send") {
      const receipt = yield* boards
        .send(agent.boardId, new ReadChannels({}))
        .pipe(Effect.provideService(CurrentActor, agent));
      const paths = (receipt.reply.channels ?? []).map((item) => item.path).join("\n");

      return toolResult(id, paths === "" ? "(no channels yet)" : paths);
    }

    if (name === "post_message" || name === "BoardApi_PostMessage_send") {
      if (body.trim() === "") return toolResult(id, "A message body is required", true);

      const receipt = yield* boards
        .send(agent.boardId, new PostMessage({ channel, body }))
        .pipe(Effect.provideService(CurrentActor, agent));

      return toolResult(id, `Posted ${receipt.reply.messageId} in #${channel}`);
    }

    return rpcError(id, -32602, `Unknown tool: ${name}`);
  }).pipe(
    Effect.catch((error: { readonly _tag?: string }) =>
      HttpServerResponse.json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: error._tag === "Unauthorized" ? -32001 : -32603,
          message:
            error._tag === "Unauthorized" ? "Unauthorized" : (error._tag ?? "Internal error"),
        },
      }),
    ),
  );

void DirectoryId;
