import * as Domain from "@alchemy.run/domain";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { Board } from "./Board.aggregate.ts";
import { DeliverFollowUp, FollowUpCanceled, FollowUpScheduled } from "./parity.commands.ts";

const followId = (scheduleId: string, generation: number) => `follow:${scheduleId}:${generation}`;

/** Post a scheduled follow-up when its delay elapses, and repeat when asked. */
export class FollowUpClock extends Domain.Policy("FollowUpClock", {
  from: Board,
  on: [FollowUpScheduled, FollowUpCanceled],
}) {}

export const FollowUpClockLive = FollowUpClock.toLayer(
  Effect.gen(function* () {
    const boards = yield* Board;

    return Effect.fn(function* ({ source, event }) {
      if (event._tag === "FollowUpCanceled") {
        for (let generation = 1; generation <= 24; generation++) {
          yield* boards
            .unschedule(source.id, followId(event.scheduleId, generation))
            .pipe(
              Effect.catchTag(
                ["AlreadyExecuted", "AlreadyCancelled", "NotScheduled"],
                () => Effect.void,
              ),
            );
        }

        return;
      }

      const delay = event.inMs ?? event.everyMs;

      if (delay === undefined) return;

      yield* boards
        .schedule(
          source.id,
          new DeliverFollowUp({ scheduleId: event.scheduleId, generation: event.generation }),
          {
            after: Duration.millis(delay),
            commandId: followId(event.scheduleId, event.generation),
          },
        )
        .pipe(Effect.catchTag("AlreadyExecuted", () => Effect.void));
    });
  }),
);
