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
  { leaseMs: Schema.Finite },
  bad,
) {}

/** The email is already registered. */
export class AccountExists extends Domain.Rejection("AccountExists", {}, conflict) {}

/** A later sign-up needs an invite from the team owner. */
export class InviteRequired extends Domain.Rejection("InviteRequired", {}, forbidden) {}

/** A password must be at least 8 characters. */
export class WeakPassword extends Domain.Rejection("WeakPassword", {}, bad) {}

/** The caller may not do that in this channel. */
export class Forbidden extends Domain.Rejection(
  "Forbidden",
  { action: Schema.String },
  forbidden,
) {}

/** That channel path is not allowed. */
export class InvalidChannel extends Domain.Rejection("InvalidChannel", {}, bad) {}

/** A channel with that path already exists. */
export class ChannelExists extends Domain.Rejection("ChannelExists", {}, conflict) {}

/** No message has that id. */
export class UnknownMessage extends Domain.Rejection("UnknownMessage", {}, missing) {}

/** Only the author, or a team owner, may change this message. */
export class NotAuthor extends Domain.Rejection("NotAuthor", {}, forbidden) {}

/** A label key or value was rejected, including reserved `board.*` keys. */
export class InvalidLabel extends Domain.Rejection("InvalidLabel", { key: Schema.String }, bad) {}

/** No schema is registered under that id. */
export class UnknownSchema extends Domain.Rejection("UnknownSchema", {}, missing) {}

/** Posted data does not match the named schema. */
export class SchemaInvalid extends Domain.Rejection(
  "SchemaInvalid",
  { reason: Schema.String },
  bad,
) {}

/** The attachment is missing a name or is larger than the board allows. */
export class InvalidAttachment extends Domain.Rejection("InvalidAttachment", {}, bad) {}

/** No attachment has that id. */
export class UnknownAttachment extends Domain.Rejection("UnknownAttachment", {}, missing) {}

/** No task has that id. */
export class UnknownTask extends Domain.Rejection("UnknownTask", {}, missing) {}

/** The task is not in the state this command needs. */
export class TaskState extends Domain.Rejection("TaskState", { state: Schema.String }, conflict) {}

/** The caller does not hold this task. */
export class ClaimLost extends Domain.Rejection("ClaimLost", {}, conflict) {}

/** No ready task matched the claim. */
export class NothingReady extends Domain.Rejection("NothingReady", {}, missing) {}

/** Only the task owner, or someone with manage, may do this. */
export class TaskNotOwned extends Domain.Rejection("TaskNotOwned", {}, forbidden) {}

/** The plan reused an idempotency key with a different body. */
export class IdempotencyConflict extends Domain.Rejection("IdempotencyConflict", {}, conflict) {}

/** A plan entry used an unknown field or an unknown need. */
export class InvalidPlan extends Domain.Rejection("InvalidPlan", { reason: Schema.String }, bad) {}

/** No grant has that id. */
export class UnknownGrant extends Domain.Rejection("UnknownGrant", {}, missing) {}

/** The schedule delay is outside the allowed range. */
export class InvalidSchedule extends Domain.Rejection("InvalidSchedule", {}, bad) {}

/** The watcher URL must be http or https. */
export class InvalidWatcher extends Domain.Rejection("InvalidWatcher", {}, bad) {}

/** The claim looked through too many channels. */
export class ChannelTreeTooLarge extends Domain.Rejection("ChannelTreeTooLarge", {}, bad) {}
