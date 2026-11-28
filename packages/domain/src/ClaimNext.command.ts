import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { AgentId, BoardId, WorkItemId } from "./ids.ts";
import { PublicWorkItem } from "./WorkItem.ts";
import { BoardClosed, InvalidLease, NotMember } from "./rejections.ts";
import { Session } from "./Session.ts";

export class WorkClaimed extends Domain.Event("WorkClaimed", {
  itemId: WorkItemId,
  agentId: AgentId,
  leaseMs: Schema.Number,
  claimGeneration: Schema.Number,
}) {}

/**
 * Claim the oldest open item. Commands on one board run one at a time, so
 * two agents cannot receive the same item.
 */
export class ClaimNext extends Domain.Command("ClaimNext", {
  target: BoardId,
  middleware: [Session],
  input: { leaseMs: Schema.Number },
  events: [WorkClaimed],
  rejects: [BoardClosed, NotMember, InvalidLease],
  reply: { item: Schema.NullOr(PublicWorkItem) },
}) {}
