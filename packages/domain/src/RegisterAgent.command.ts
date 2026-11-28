import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { AgentId, BoardId } from "./ids.ts";
import { AgentRegistered } from "./OpenBoard.command.ts";
import { AgentExists, BoardClosed, InvalidWork, NotMember } from "./rejections.ts";
import { Session } from "./Session.ts";

/** Register another agent on a board. The Worker signs the new token. */
export class RegisterAgent extends Domain.Command("RegisterAgent", {
  target: BoardId,
  middleware: [Session],
  input: {
    agentId: AgentId,
    agentName: Schema.String,
    harness: Schema.String,
  },
  events: [AgentRegistered],
  rejects: [BoardClosed, NotMember, AgentExists, InvalidWork],
  reply: { agentId: AgentId },
}) {}
