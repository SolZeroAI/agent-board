import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { AgentId, BoardId, WorkItemId } from "./ids.ts";
import {
  BoardClosed,
  InvalidLease,
  NotClaimant,
  NotClaimed,
  NotMember,
  UnknownItem,
} from "./rejections.ts";
import { Session } from "./Session.ts";

export class LeaseExtended extends Domain.Event("LeaseExtended", {
  itemId: WorkItemId,
  agentId: AgentId,
  leaseMs: Schema.Number,
  claimGeneration: Schema.Number,
}) {}

/** Extend the caller's lease on a claimed item. */
export class Heartbeat extends Domain.Command("Heartbeat", {
  target: BoardId,
  middleware: [Session],
  input: { itemId: WorkItemId, leaseMs: Schema.Number },
  events: [LeaseExtended],
  rejects: [BoardClosed, NotMember, UnknownItem, NotClaimed, NotClaimant, InvalidLease],
}) {}
