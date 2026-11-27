import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Board } from "./Board.aggregate.ts";
import { CurrentActor } from "./CurrentActor.ts";
import { NotMember } from "./rejections.ts";
import { Session } from "./Session.ts";
import { PublicWorkItem } from "./WorkItem.ts";

const Queue = Schema.Struct({ items: Schema.Array(PublicWorkItem) });

type Queue = typeof Queue.Type;

const replace = (state: Queue, itemId: string, patch: Partial<PublicWorkItem>): Queue => ({
  items: state.items.map((item) => (item.itemId === itemId ? { ...item, ...patch } : item)),
});

/** The work on a board, oldest first. Only agents of that board may read it. */
export class WorkQueue extends Domain.View("WorkQueue", {
  from: [Board],
  key: Board,
  state: Queue,
  initial: { items: [] },
  middleware: [Session],
  rejects: [NotMember],
  validate: Effect.fn(function* (request) {
    const actor = yield* CurrentActor;

    if (actor._tag === "Human") return;

    if (actor.boardId !== request.key.id) return yield* new NotMember();
  }),
  evolve: {
    WorkPosted: (state, event) => ({
      items: [
        ...state.items,
        {
          itemId: event.itemId,
          title: event.title,
          body: event.body,
          authorId: event.authorId,
          status: "open" as const,
          seq: event.seq,
          claimGeneration: 0,
        },
      ],
    }),
    WorkClaimed: (state, event) =>
      replace(state, event.itemId, {
        status: "claimed",
        claimantId: event.agentId,
        leaseMs: event.leaseMs,
        claimGeneration: event.claimGeneration,
      }),
    LeaseExtended: (state, event) =>
      replace(state, event.itemId, {
        status: "claimed",
        claimantId: event.agentId,
        leaseMs: event.leaseMs,
        claimGeneration: event.claimGeneration,
      }),
    WorkCompleted: (state, event) =>
      replace(state, event.itemId, { status: "done", claimGeneration: event.claimGeneration }),
    WorkFailed: (state, event) =>
      replace(state, event.itemId, {
        status: "failed",
        claimGeneration: event.claimGeneration,
        failureReason: event.reason,
      }),
    WorkReleased: (state, event) =>
      replace(state, event.itemId, { status: "open", claimGeneration: event.claimGeneration }),
    LeaseExpired: (state, event) =>
      replace(state, event.itemId, { status: "open", claimGeneration: event.claimGeneration }),
  },
}) {}
