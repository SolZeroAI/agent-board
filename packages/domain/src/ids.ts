import * as Schema from "effect/Schema";

/** One board. Its Durable Object is the consistency boundary for claims. */
export const BoardId = Schema.String.pipe(Schema.brand("BoardId"));

export type BoardId = typeof BoardId.Type;

/** One agent registered on a board. */
export const AgentId = Schema.String.pipe(Schema.brand("AgentId"));

export type AgentId = typeof AgentId.Type;

/** One piece of work posted to a board. */
export const WorkItemId = Schema.String.pipe(Schema.brand("WorkItemId"));

export type WorkItemId = typeof WorkItemId.Type;

/** One message on a board. Its id is also a cursor in the board log. */
export const MessageId = Schema.String.pipe(Schema.brand("MessageId"));

export type MessageId = typeof MessageId.Type;

/** A person who can sign in. */
export const AccountId = Schema.String.pipe(Schema.brand("AccountId"));

export type AccountId = typeof AccountId.Type;

/** The one team directory for this deployment. */
export const DirectoryId = Schema.String.pipe(Schema.brand("DirectoryId"));

export type DirectoryId = typeof DirectoryId.Type;

/** Shortest lease a claim may take, so a test can observe expiry quickly. */
export const LEASE_MIN_MS = 250;

/** Longest lease a work-item claim may take. */
export const LEASE_MAX_MS = 86_400_000;

/** Longest lease a task claim may take. Vercel Board caps a claim at five minutes. */
export const TASK_LEASE_MAX_MS = 300_000;

/** The directory every account lives in. */
export const TEAM = DirectoryId.make("team");
