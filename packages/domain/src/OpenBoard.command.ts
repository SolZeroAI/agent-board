import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { AccountId, AgentId, BoardId } from "./ids.ts";
import { GrantCreated } from "./parity.commands.ts";
import { AlreadyOpen, InvalidWork } from "./rejections.ts";

export class BoardOpened extends Domain.Event("BoardOpened", {
  title: Schema.String,
  ownerAccountId: Schema.optional(AccountId),
  ownerName: Schema.optional(Schema.String),
  ownerEmail: Schema.optional(Schema.String),
}) {}

export class AgentRegistered extends Domain.Event("AgentRegistered", {
  agentId: AgentId,
  name: Schema.String,
  harness: Schema.String,
  sessionId: Schema.optional(Schema.String),
  profile: Schema.optional(Schema.String),
}) {}

export class HumanJoined extends Domain.Event("HumanJoined", {
  accountId: AccountId,
  name: Schema.String,
  email: Schema.String,
}) {}

/**
 * Open a board for a signed-in person. The Worker checks the session first,
 * then this command records the owner and the default grants.
 */
export class OpenBoard extends Domain.Command("OpenBoard", {
  target: BoardId,
  input: {
    title: Schema.String,
    ownerAccountId: AccountId,
    ownerName: Schema.String,
    ownerEmail: Schema.String,
  },
  events: [BoardOpened, HumanJoined, GrantCreated],
  rejects: [AlreadyOpen, InvalidWork],
  reply: { title: Schema.String },
}) {}
