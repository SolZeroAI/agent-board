import * as Domain from "@alchemy.run/domain";
import * as Layer from "effect/Layer";

import { Board } from "./Board.aggregate.ts";
import { Inbox } from "./Inbox.view.ts";
import { ItemThread } from "./ItemThread.view.ts";
import { LeaseDeadline, LeaseDeadlineLive } from "./LeaseDeadline.policy.ts";
import { WorkQueue } from "./WorkQueue.view.ts";

/** The board, its reads, and the lease deadline, hosted together. */
export class AgentBoard extends Domain.Model("AgentBoard", {
  aggregates: [Board],
  views: [WorkQueue, Inbox, ItemThread],
  policies: [LeaseDeadline],
}) {}

export const AgentBoardPolicies = Layer.mergeAll(LeaseDeadlineLive);
