import * as Domain from "@alchemy.run/domain";

import { Actor } from "./Actor.ts";

/**
 * The agent making the current request. `Session` provides it. Commands read
 * it in `decide` and views read it in `validate`.
 */
export class CurrentActor extends Domain.RequestContext<CurrentActor>()(
  "AgentBoard/CurrentActor",
  Actor,
) {}
