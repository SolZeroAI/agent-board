import { Actor } from "@agent-board/domain";
import { CurrentActor, Session, Unauthorized } from "@agent-board/domain";
import * as Alchemy from "alchemy";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Headers from "effect/http/Headers";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/** The key that signs agent tokens. Created once per stage and kept in state. */
export class SessionKey extends Context.Service<SessionKey, Effect.Effect<Redacted.Redacted>>()(
  "AgentBoard/SessionKey",
) {}

/** A random signing key, made on the first dev or deploy of the stage. */
export const SessionKeyLive = Layer.effect(
  SessionKey,
  Effect.gen(function* () {
    const key = yield* Alchemy.Random("SessionKey");

    return yield* key.text;
  }),
);

const SESSION_MS = 365 * 24 * 60 * 60 * 1000;

const Claims = Schema.fromJsonString(
  Schema.Struct({
    actor: Actor,
    expires: Schema.Number,
  }),
);

const hmacKey = Effect.fn(function* () {
  const secret = Redacted.value(yield* yield* SessionKey);

  return yield* Effect.promise(() =>
    crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    ),
  );
});

/** A bearer token for an agent. The raw token is not written to the event log. */
export const signSession = Effect.fn(function* (actor: Actor) {
  const expires = (yield* Clock.currentTimeMillis) + SESSION_MS;
  const json = yield* Schema.encodeEffect(Claims)({ actor, expires }).pipe(Effect.orDie);
  const claims = Base64Url.encode(json);
  const key = yield* hmacKey();

  const mac = yield* Effect.promise(() =>
    crypto.subtle.sign("HMAC", key, new TextEncoder().encode(claims)),
  );

  return `${claims}.${Base64Url.encode(new Uint8Array(mac))}`;
});

const verifySession = Effect.fn(function* (token: string) {
  const [claims, mac, ...rest] = token.split(".");

  if (claims === undefined || mac === undefined || rest.length > 0) return Option.none<Actor>();
  const signature = Base64Url.decode(mac);

  if (Result.isFailure(signature)) return Option.none<Actor>();
  const key = yield* hmacKey();

  const valid = yield* Effect.promise(() =>
    crypto.subtle.verify(
      "HMAC",
      key,
      new Uint8Array(signature.success),
      new TextEncoder().encode(claims),
    ),
  );

  const json = Base64Url.decodeString(claims);

  if (!valid || Result.isFailure(json)) return Option.none<Actor>();
  const decoded = yield* Schema.decodeEffect(Claims)(json.success).pipe(Effect.option);
  const now = yield* Clock.currentTimeMillis;

  return Option.flatMap(decoded, (claim) =>
    claim.expires > now ? Option.some(claim.actor) : Option.none(),
  );
});

const tokenOf = (headers: Headers.Headers): Option.Option<string> =>
  Option.flatMap(Headers.get(headers, "authorization"), (value) =>
    value.startsWith("Bearer ") ? Option.some(value.slice("Bearer ".length)) : Option.none(),
  );

/** The actor a request's bearer token names, when the token is valid. */
export const actorFromHeaders = (headers: Headers.Headers) =>
  Option.match(tokenOf(headers), {
    onNone: () => Effect.succeed(Option.none<Actor>()),
    onSome: (token) => verifySession(token),
  });

/** The {@link Session} middleware. */
export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const key = yield* SessionKey;

    return (effect, { headers }) =>
      Option.match(tokenOf(headers), {
        onNone: () => Effect.fail(new Unauthorized()),
        onSome: (token) =>
          verifySession(token).pipe(
            Effect.provideService(SessionKey, key),
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(new Unauthorized()),
                onSome: (actor) => Effect.provideService(effect, CurrentActor, actor),
              }),
            ),
          ),
      });
  }),
);
