import * as Domain from "@alchemy.run/domain";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { Board } from "./Board.aggregate.ts";
import { ExpireTask, TaskClaimed, TaskRenewed } from "./parity.commands.ts";

const taskLeaseId = (taskId: string, claimGeneration: number) =>
  `task-lease:${taskId}:${claimGeneration}`;

/** Return a task to ready when its claim expires. */
export class TaskLease extends Domain.Policy("TaskLease", {
  from: Board,
  on: [TaskClaimed, TaskRenewed],
}) {}

export const TaskLeaseLive = TaskLease.toLayer(
  Effect.gen(function* () {
    const boards = yield* Board;

    return Effect.fn(function* ({ source, event }) {
      if (event._tag === "TaskClaimed" || event._tag === "TaskRenewed") {
        yield* boards
          .schedule(
            source.id,
            new ExpireTask({ taskId: event.taskId, claimGeneration: event.claimGeneration }),
            {
              after: Duration.millis(event.leaseMs),
              commandId: taskLeaseId(event.taskId, event.claimGeneration),
            },
          )
          .pipe(Effect.catchTag("AlreadyExecuted", () => Effect.void));
      }
    });
  }),
);
