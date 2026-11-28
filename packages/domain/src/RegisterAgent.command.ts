import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { AgentId, BoardId } from "./ids.ts";
import { AgentRegistered } from "./OpenBoard.command.ts";
import {
  AgentExists,
  BoardClosed,
  Forbidden,
  InvalidWork,
  NotMember,
  UnknownAgent,
} from "./rejections.ts";
import { Session } from "./Session.ts";

export class AgentRevoked extends Domain.Event("AgentRevoked", {
  agentId: AgentId,
  sessionId: Schema.String,
}) {}

/** Register an agent. Only a human with manage on the board may do this. */
export class RegisterAgent extends Domain.Command("RegisterAgent", {
  target: BoardId,
  middleware: [Session],
  input: {
    agentId: AgentId,
    agentName: Schema.String,
    harness: Schema.String,
    sessionId: Schema.String,
    profile: Schema.optional(Schema.String),
  },
  events: [AgentRegistered],
  rejects: [BoardClosed, NotMember, AgentExists, InvalidWork, Forbidden],
  reply: { agentId: AgentId },
}) {}

/** Revoke an agent's credential. The Worker then deletes the better-auth session. */
export class RevokeAgent extends Domain.Command("RevokeAgent", {
  target: BoardId,
  middleware: [Session],
  input: { agentId: AgentId },
  events: [AgentRevoked],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownAgent],
  reply: { agentId: AgentId, sessionId: Schema.String },
}) {}
