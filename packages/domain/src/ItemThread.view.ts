import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Board } from "./Board.aggregate.ts";
import { CurrentActor } from "./CurrentActor.ts";
import { WorkItemId } from "./ids.ts";
import { NotMember } from "./rejections.ts";
import { Session } from "./Session.ts";
import { PublicMessage } from "./WorkItem.ts";

const Thread = Schema.Struct({
  boardId: Schema.String,
  messages: Schema.Array(PublicMessage),
});

type Thread = typeof Thread.Type;

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

/** Messages attached to one work item. Agents of another board cannot read it. */
export class ItemThread extends Domain.View("ItemThread", {
  from: [Board],
  key: WorkItemId,
  keyOf: {
    MessageSent: ({ event }) => event.itemId,
  },
  state: Thread,
  initial: { boardId: "", messages: [] },
  middleware: [Session],
  rejects: [NotMember],
  validate: Effect.fn(function* (_request, state) {
    const actor = yield* CurrentActor;

    if (actor._tag === "Human") return;

    if (state !== null && state.boardId.length > 0 && state.boardId !== actor.boardId) {
      return yield* new NotMember();
    }
  }),
  evolve: {
    MessageSent: (state, event, context) => ({
      boardId: context.source.id,
      messages: [...state.messages, asMessage(event)],
    }),
  },
}) {}
