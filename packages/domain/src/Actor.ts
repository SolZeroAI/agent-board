import * as Schema from "effect/Schema";

import { AccountId, AgentId, BoardId } from "./ids.ts";

/** A permission ceiling pasted onto a narrowed token. It can only remove access. */
export const Ceiling = Schema.Struct({
  pattern: Schema.String,
  permissions: Schema.Array(Schema.Literals(["read", "post", "react", "label", "manage"])),
});

export type Ceiling = typeof Ceiling.Type;

const profile = Schema.optional(Schema.String);
const ceiling = Schema.optional(Schema.Array(Ceiling));

/**
 * Who is calling. A human signs in and may act as a profile. An agent token
 * is board-scoped. A profile never grants access by itself.
 */
export const Actor = Schema.Union([
  Schema.TaggedStruct("Human", {
    accountId: AccountId,
    name: Schema.String,
    email: Schema.String,
    role: Schema.Literals(["owner", "member"]),
    profile,
    ceiling,
  }),
  Schema.TaggedStruct("Agent", {
    boardId: BoardId,
    agentId: AgentId,
    name: Schema.String,
    profile,
    ceiling,
  }),
]);

export type Actor = typeof Actor.Type;

/** The id the board records as the author of this actor's writes. */
export const actorId = (actor: Actor) => (actor._tag === "Human" ? actor.accountId : actor.agentId);
