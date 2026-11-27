import * as Domain from "@alchemy.run/domain";
import * as Layer from "effect/Layer";

import { Board } from "./Board.aggregate.ts";
import { Directory } from "./Directory.aggregate.ts";
import { Inbox } from "./Inbox.view.ts";
import { ItemThread } from "./ItemThread.view.ts";
import { FollowUpClock, FollowUpClockLive } from "./FollowUp.policy.ts";
import { LeaseDeadline, LeaseDeadlineLive } from "./LeaseDeadline.policy.ts";
import { TaskLease, TaskLeaseLive } from "./TaskLease.policy.ts";
import { WatcherWake, WatcherWakeLive } from "./WatcherWake.policy.ts";
import { WorkQueue } from "./WorkQueue.view.ts";

/** The board, its reads, and the policies that wake work after a command. */
export class AgentBoard extends Domain.Model("AgentBoard", {
  aggregates: [Board, Directory],
  views: [WorkQueue, Inbox, ItemThread],
  policies: [LeaseDeadline, TaskLease, FollowUpClock, WatcherWake],
}) {}

export const AgentBoardPolicies = Layer.mergeAll(
  LeaseDeadlineLive,
  TaskLeaseLive,
  FollowUpClockLive,
  WatcherWakeLive,
);
