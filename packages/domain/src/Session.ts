import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";

import { CurrentActor } from "./CurrentActor.ts";

/** The request has no usable bearer token. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}

/**
 * Authenticates a bearer token and provides the {@link CurrentActor}.
 * The Worker signs tokens. This service only checks them.
 */
export class Session extends RpcMiddleware.Service<Session, { provides: CurrentActor }>()(
  "AgentBoard/Session",
  { error: Unauthorized },
) {}
