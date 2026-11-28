import { RuntimeContext } from "alchemy";
import {
  AccountId,
  AgentId,
  BoardId,
  CurrentActor,
  Session,
  Unauthorized,
} from "@agent-board/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Headers from "effect/http/Headers";

import { BoardAuth, type BoardAuthService } from "./Auth.ts";

const headerValue = (headers: Readonly<Record<string, string | undefined>>, name: string) => {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);

  return found?.[1];
};

const sessionToken = (headers: Readonly<Record<string, string | undefined>>) => {
  const authorization = headerValue(headers, "authorization");

  if (authorization !== undefined && authorization.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();

    if (token !== "") return token;
  }

  const cookie = headerValue(headers, "cookie") ?? "";
  const pair = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("board_session="));

  if (pair === undefined) return undefined;

  const token = decodeURIComponent(pair.slice("board_session=".length));

  return token === "" ? undefined : token;
};

interface AuthContext {
  readonly internalAdapter: {
    readonly findSession: (token: string) => Promise<{
      readonly session: Record<string, unknown>;
      readonly user: Record<string, unknown>;
    } | null>;
  };
}

const contextOf = (auth: BoardAuthService) =>
  Effect.gen(function* () {
    const instance = yield* auth.auth;

    return yield* Effect.promise(() => instance.$context as Promise<AuthContext>);
  });

const actorFromSession = (
  session: Record<string, unknown>,
  user: Record<string, unknown>,
  presented: string,
) => {
  const bound = typeof session.profile === "string" ? session.profile : "";

  if (presented !== "" && presented !== bound) return undefined;

  const profile = bound === "" ? undefined : bound;
  const expiresAt = session.expiresAt;
  const expires =
    expiresAt instanceof Date
      ? expiresAt.getTime()
      : typeof expiresAt === "string" || typeof expiresAt === "number"
        ? new Date(expiresAt).getTime()
        : Number.POSITIVE_INFINITY;

  if (expires <= Date.now()) return undefined;

  if (session.kind === "agent") {
    return {
      _tag: "Agent" as const,
      boardId: BoardId.make(typeof session.boardId === "string" ? session.boardId : ""),
      agentId: AgentId.make(typeof session.agentId === "string" ? session.agentId : ""),
      name: typeof session.agentName === "string" ? session.agentName : String(user.name ?? ""),
      ...(profile === undefined ? {} : { profile }),
    };
  }

  return {
    _tag: "Human" as const,
    accountId: AccountId.make(String(user.id ?? "")),
    name: String(user.name ?? ""),
    email: String(user.email ?? ""),
    role: user.role === "owner" ? ("owner" as const) : ("member" as const),
    ...(profile === undefined ? {} : { profile }),
  };
};

/** The person or agent behind a bearer token, the board cookie, or the better-auth cookie. */
export const resolveActor = (auth: BoardAuthService, headers: Headers.Headers) =>
  Effect.gen(function* () {
    const presented = headerValue(headers, "x-board-as") ?? "";
    const token = sessionToken(headers);

    if (token !== undefined) {
      const context = yield* contextOf(auth);
      const found = yield* Effect.promise(() => context.internalAdapter.findSession(token));

      if (found !== null) {
        const actor = actorFromSession(found.session, found.user, presented);

        if (actor === undefined) return yield* new Unauthorized();

        return actor;
      }
    }

    const request = new globalThis.Headers();

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) request.set(key, value);
    }

    const session = yield* auth.getSession(request).pipe(Effect.orElseSucceed(() => null));

    if (session === null) return yield* new Unauthorized();

    const actor = actorFromSession(
      session.session as unknown as Record<string, unknown>,
      session.user as unknown as Record<string, unknown>,
      presented,
    );

    if (actor === undefined) return yield* new Unauthorized();

    return actor;
  });

/**
 * Turns a better-auth session into the actor for one command.
 * `x-board-as` is accepted only when it is the profile bound to that session.
 */
export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const auth = yield* BoardAuth;

    return (effect, { headers }) =>
      resolveActor(auth, headers).pipe(
        Effect.flatMap((actor) => effect.pipe(Effect.provideService(CurrentActor, actor))),
        Effect.provide(RuntimeContext.phantom),
      );
  }),
);
