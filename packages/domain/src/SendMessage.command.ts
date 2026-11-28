import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { AgentId, BoardId, MessageId, WorkItemId } from "./ids.ts";
import { BoardClosed, InvalidMessage, NotMember, UnknownAgent, UnknownItem } from "./rejections.ts";
import { Session } from "./Session.ts";

export class MessageSent extends Domain.Event("MessageSent", {
  messageId: MessageId,
  fromAgentId: AgentId,
  body: Schema.String,
  seq: Schema.Finite,
  toAgentId: Schema.optional(AgentId),
  itemId: Schema.optional(WorkItemId),
}) {}

/** Send a message to another agent, to a work item, or to both. */
export class SendMessage extends Domain.Command("SendMessage", {
  target: BoardId,
  middleware: [Session],
  input: {
    messageId: MessageId,
    body: Schema.String,
    toAgentId: Schema.optional(AgentId),
    itemId: Schema.optional(WorkItemId),
  },
  events: [MessageSent],
  rejects: [BoardClosed, NotMember, UnknownAgent, UnknownItem, InvalidMessage],
  reply: { messageId: MessageId, seq: Schema.Finite },
}) {}
