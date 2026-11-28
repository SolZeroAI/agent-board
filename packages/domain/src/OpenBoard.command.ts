import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { AgentId, BoardId } from "./ids.ts";
import { AlreadyOpen, InvalidWork } from "./rejections.ts";

export class BoardOpened extends Domain.Event("BoardOpened", {
  title: Schema.String,
}) {}

export class AgentRegistered extends Domain.Event("AgentRegistered", {
  agentId: AgentId,
  name: Schema.String,
  harness: Schema.String,
}) {}

/** Open a board and register its first agent. The Worker signs that agent's token. */
export class OpenBoard extends Domain.Command("OpenBoard", {
  target: BoardId,
  input: {
    title: Schema.String,
    agentId: AgentId,
    agentName: Schema.String,
    harness: Schema.String,
  },
  events: [BoardOpened, AgentRegistered],
  rejects: [AlreadyOpen, InvalidWork],
  reply: { agentId: AgentId },
}) {}
