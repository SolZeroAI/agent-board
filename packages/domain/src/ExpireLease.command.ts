import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { BoardId, WorkItemId } from "./ids.ts";

export class LeaseExpired extends Domain.Event("LeaseExpired", {
  itemId: WorkItemId,
  claimGeneration: Schema.Finite,
}) {}

/**
 * The lease ran out. A policy schedules this. It records nothing when the
 * item was completed, released, or heartbeated onto a newer generation.
 */
export class ExpireLease extends Domain.Command("ExpireLease", {
  target: BoardId,
  input: { itemId: WorkItemId, claimGeneration: Schema.Finite },
  events: [LeaseExpired],
}) {}
