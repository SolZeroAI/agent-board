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

/** One message on a board. */
export const MessageId = Schema.String.pipe(Schema.brand("MessageId"));

export type MessageId = typeof MessageId.Type;

/** Shortest lease a claim may take, so a test can observe expiry quickly. */
export const LEASE_MIN_MS = 250;

/** Longest lease a claim may take. */
export const LEASE_MAX_MS = 86_400_000;
