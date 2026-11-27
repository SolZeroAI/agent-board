import * as Schema from "effect/Schema";

import { AgentId, BoardId } from "./ids.ts";

/** Who is calling. Session middleware provides this on every guarded command. */
export const Actor = Schema.Struct({
  boardId: BoardId,
  agentId: AgentId,
});

export type Actor = typeof Actor.Type;
