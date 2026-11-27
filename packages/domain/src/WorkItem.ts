import * as Schema from "effect/Schema";

import { AgentId, WorkItemId } from "./ids.ts";

/** What a client may see of a work item. Tokens never appear here. */
export const PublicWorkItem = Schema.Struct({
  itemId: WorkItemId,
  title: Schema.String,
  body: Schema.String,
  authorId: AgentId,
  status: Schema.Literals(["open", "claimed", "done", "failed"]),
  seq: Schema.Number,
  claimGeneration: Schema.Number,
  claimantId: Schema.optional(AgentId),
  leaseMs: Schema.optional(Schema.Number),
  failureReason: Schema.optional(Schema.String),
});

export type PublicWorkItem = typeof PublicWorkItem.Type;

/** What a client may see of a message. */
export const PublicMessage = Schema.Struct({
  messageId: Schema.String,
  fromAgentId: AgentId,
  body: Schema.String,
  seq: Schema.Number,
  toAgentId: Schema.optional(AgentId),
  itemId: Schema.optional(WorkItemId),
});

export type PublicMessage = typeof PublicMessage.Type;
