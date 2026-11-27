import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Board } from "./Board.aggregate.ts";
import { CurrentActor } from "./CurrentActor.ts";
import { AgentId } from "./ids.ts";
import { NotMember } from "./rejections.ts";
import { Session } from "./Session.ts";
import { PublicMessage } from "./WorkItem.ts";

const InboxState = Schema.Struct({ messages: Schema.Array(PublicMessage) });

const asMessage = (event: {
  readonly messageId: PublicMessage["messageId"];
  readonly fromAgentId: PublicMessage["fromAgentId"];
  readonly body: string;
  readonly seq: number;
  readonly toAgentId?: PublicMessage["toAgentId"];
  readonly itemId?: PublicMessage["itemId"];
}): PublicMessage => ({
  messageId: event.messageId,
  fromAgentId: event.fromAgentId,
  body: event.body,
  seq: event.seq,
  ...(event.toAgentId === undefined ? {} : { toAgentId: event.toAgentId }),
  ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
});

/** Messages addressed to one agent. */
export class Inbox extends Domain.View("Inbox", {
  from: [Board],
  key: AgentId,
  keyOf: {
    MessageSent: ({ event }) => event.toAgentId,
  },
  state: InboxState,
  initial: { messages: [] },
  middleware: [Session],
  rejects: [NotMember],
  validate: Effect.fn(function* (request) {
    const actor = yield* CurrentActor;

    if (actor._tag !== "Agent" || actor.agentId !== request.key) return yield* new NotMember();
  }),
  evolve: {
    MessageSent: (state, event) => ({ messages: [...state.messages, asMessage(event)] }),
  },
}) {}
