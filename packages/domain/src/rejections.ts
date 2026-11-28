import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

const forbidden = { httpApiStatus: 403 } as const;
const conflict = { httpApiStatus: 409 } as const;
const bad = { httpApiStatus: 400 } as const;
const missing = { httpApiStatus: 404 } as const;

/** The board was already opened. */
export class AlreadyOpen extends Domain.Rejection("AlreadyOpen", {}, conflict) {}

/** The board has not been opened. */
export class BoardClosed extends Domain.Rejection("BoardClosed", {}, missing) {}

/** The caller is not a registered agent of this board. */
export class NotMember extends Domain.Rejection("NotMember", {}, forbidden) {}

/** That agent id is already registered. */
export class AgentExists extends Domain.Rejection("AgentExists", {}, conflict) {}

/** No work item has that id. */
export class UnknownItem extends Domain.Rejection("UnknownItem", {}, missing) {}

/** No agent has that id. */
export class UnknownAgent extends Domain.Rejection("UnknownAgent", {}, missing) {}

/** Only the agent that holds the lease may do this. */
export class NotClaimant extends Domain.Rejection("NotClaimant", {}, forbidden) {}

/** The work item is not in the state this command needs. */
export class NotClaimed extends Domain.Rejection("NotClaimed", {}, conflict) {}

/** A title, body, name, or harness was empty. */
export class InvalidWork extends Domain.Rejection("InvalidWork", {}, bad) {}

/** A message needs a body and an agent or a work item to land on. */
export class InvalidMessage extends Domain.Rejection("InvalidMessage", {}, bad) {}

/** A lease must be between the minimum and maximum duration. */
export class InvalidLease extends Domain.Rejection(
  "InvalidLease",
  { leaseMs: Schema.Number },
  bad,
) {}
