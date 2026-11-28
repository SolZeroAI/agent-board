import * as Domain from "@alchemy.run/domain";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { Board } from "./Board.aggregate.ts";
import { WorkClaimed } from "./ClaimNext.command.ts";
import { WorkCompleted, WorkFailed, WorkReleased } from "./CompleteWork.command.ts";
import { ExpireLease } from "./ExpireLease.command.ts";
import { LeaseExtended } from "./Heartbeat.command.ts";

/** The id of the scheduled expiry for one claim generation. */
export const leaseCommandId = (itemId: string, claimGeneration: number) =>
  `lease:${itemId}:${claimGeneration}`;

/**
 * Arm a lease expiry when work is claimed or heartbeated, and cancel it when
 * the item is finished or released. The board decides the race.
 */
export class LeaseDeadline extends Domain.Policy("LeaseDeadline", {
  from: Board,
  on: [WorkClaimed, LeaseExtended, WorkCompleted, WorkFailed, WorkReleased],
}) {}

export const LeaseDeadlineLive = LeaseDeadline.toLayer(
  Effect.gen(function* () {
    const boards = yield* Board;

    return Effect.fn(function* ({ source, event }) {
      if (event._tag === "WorkClaimed" || event._tag === "LeaseExtended") {
        yield* boards
          .schedule(
            source.id,
            new ExpireLease({ itemId: event.itemId, claimGeneration: event.claimGeneration }),
            {
              after: Duration.millis(event.leaseMs),
              commandId: leaseCommandId(event.itemId, event.claimGeneration),
            },
          )
          .pipe(Effect.catchTag("AlreadyExecuted", () => Effect.void));

        return;
      }

      yield* boards
        .unschedule(source.id, leaseCommandId(event.itemId, event.claimGeneration))
        .pipe(
          Effect.catchTag(
            ["AlreadyExecuted", "AlreadyCancelled", "NotScheduled"],
            () => Effect.void,
          ),
        );
    });
  }),
);
