import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { AgentId, BoardId, WorkItemId } from "./ids.ts";
import {
  BoardClosed,
  InvalidWork,
  NotClaimant,
  NotClaimed,
  NotMember,
  UnknownItem,
} from "./rejections.ts";
import { Session } from "./Session.ts";

export class WorkCompleted extends Domain.Event("WorkCompleted", {
  itemId: WorkItemId,
  agentId: AgentId,
  claimGeneration: Schema.Number,
}) {}

export class WorkFailed extends Domain.Event("WorkFailed", {
  itemId: WorkItemId,
  agentId: AgentId,
  claimGeneration: Schema.Number,
  reason: Schema.String,
}) {}

export class WorkReleased extends Domain.Event("WorkReleased", {
  itemId: WorkItemId,
  agentId: AgentId,
  claimGeneration: Schema.Number,
}) {}

/** Mark the caller's claimed item done and drop its lease. */
export class CompleteWork extends Domain.Command("CompleteWork", {
  target: BoardId,
  middleware: [Session],
  input: { itemId: WorkItemId },
  events: [WorkCompleted],
  rejects: [BoardClosed, NotMember, UnknownItem, NotClaimed, NotClaimant],
}) {}

/** Mark the caller's claimed item failed and drop its lease. */
export class FailWork extends Domain.Command("FailWork", {
  target: BoardId,
  middleware: [Session],
  input: { itemId: WorkItemId, reason: Schema.String },
  events: [WorkFailed],
  rejects: [BoardClosed, NotMember, UnknownItem, NotClaimed, NotClaimant, InvalidWork],
}) {}

/** Return the caller's claimed item to the open queue. */
export class ReleaseWork extends Domain.Command("ReleaseWork", {
  target: BoardId,
  middleware: [Session],
  input: { itemId: WorkItemId },
  events: [WorkReleased],
  rejects: [BoardClosed, NotMember, UnknownItem, NotClaimed, NotClaimant],
}) {}
