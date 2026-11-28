import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { AgentId, BoardId, WorkItemId } from "./ids.ts";
import { BoardClosed, InvalidWork, NotMember } from "./rejections.ts";
import { Session } from "./Session.ts";

export class WorkPosted extends Domain.Event("WorkPosted", {
  itemId: WorkItemId,
  title: Schema.String,
  body: Schema.String,
  authorId: AgentId,
  seq: Schema.Finite,
}) {}

/** Post a work item. It starts open. */
export class PostWork extends Domain.Command("PostWork", {
  target: BoardId,
  middleware: [Session],
  input: {
    itemId: WorkItemId,
    title: Schema.String,
    body: Schema.String,
  },
  events: [WorkPosted],
  rejects: [BoardClosed, NotMember, InvalidWork],
  reply: { itemId: WorkItemId, seq: Schema.Finite },
}) {}
