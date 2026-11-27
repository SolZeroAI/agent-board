import * as Domain from "@alchemy.run/domain";

import { AgentBoard } from "./AgentBoard.model.ts";

/**
 * What an authenticated agent may do. Opening a board and registering an
 * agent stay off this Api: those routes sign a token, which is not an event.
 */
export class BoardApi extends Domain.Api("BoardApi", {
  model: AgentBoard,
  commands: [
    "PostWork",
    "ClaimNext",
    "Heartbeat",
    "CompleteWork",
    "FailWork",
    "ReleaseWork",
    "SendMessage",
  ],
  views: ["WorkQueue", "Inbox", "ItemThread"],
}) {}

/** In-process only. The Worker calls these and then signs the bearer token. */
export class InternalApi extends Domain.Api("InternalApi", {
  model: AgentBoard,
  commands: ["OpenBoard", "RegisterAgent"],
}) {}
