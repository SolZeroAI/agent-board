import * as Schema from "effect/Schema";

import { AgentId, WorkItemId } from "./ids.ts";
import { PERMISSIONS } from "./grants.ts";

const PermissionSchema = Schema.Literals(PERMISSIONS);

export const PrincipalSchema = Schema.Union([
  Schema.TaggedStruct("User", { email: Schema.String }),
  Schema.TaggedStruct("Agent", { agentId: Schema.String }),
  Schema.TaggedStruct("AllUsers", {}),
  Schema.TaggedStruct("AllAgents", {}),
  Schema.TaggedStruct("Everyone", {}),
]);

export const GrantSchema = Schema.Struct({
  grantId: Schema.String,
  principals: Schema.Array(PrincipalSchema),
  pattern: Schema.String,
  permissions: Schema.Array(PermissionSchema),
});

export const Labels = Schema.Record(Schema.String, Schema.String);

export const ReactionSchema = Schema.Struct({
  emoji: Schema.String,
  actorId: Schema.String,
});

export const AttachmentSchema = Schema.Struct({
  attachmentId: Schema.String,
  name: Schema.String,
  mediaType: Schema.String,
  dataBase64: Schema.String,
});

export const MessageSchema = Schema.Struct({
  messageId: Schema.String,
  channel: Schema.String,
  threadId: Schema.String,
  body: Schema.String,
  authorId: Schema.String,
  authorName: Schema.String,
  profile: Schema.optional(Schema.String),
  labels: Labels,
  mentions: Schema.Array(Schema.String),
  reactions: Schema.Array(ReactionSchema),
  attachments: Schema.Array(AttachmentSchema),
  schemaId: Schema.optional(Schema.String),
  dataJson: Schema.optional(Schema.String),
  deleted: Schema.Boolean,
  seq: Schema.Number,
  createdAt: Schema.Number,
});

export type Message = typeof MessageSchema.Type;

export const TaskStateSchema = Schema.Literals([
  "waiting",
  "ready",
  "claimed",
  "blocked",
  "completed",
  "failed",
  "canceled",
]);

export const TaskSchema = Schema.Struct({
  taskId: Schema.String,
  channel: Schema.String,
  state: TaskStateSchema,
  ownerId: Schema.String,
  ownerProfile: Schema.optional(Schema.String),
  assignee: Schema.optional(Schema.String),
  needs: Schema.Array(Schema.String),
  claimGeneration: Schema.Number,
  claimantId: Schema.optional(Schema.String),
  claimantProfile: Schema.optional(Schema.String),
  leaseMs: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  blockedKind: Schema.optional(Schema.String),
  blockedPrompt: Schema.optional(Schema.String),
  seq: Schema.Number,
});

export type Task = typeof TaskSchema.Type;

export const FeedSchema = Schema.Struct({
  cursor: Schema.String,
  seq: Schema.Number,
  type: Schema.String,
  createdAt: Schema.Number,
  actorId: Schema.String,
  actorName: Schema.String,
  profile: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
  messageId: Schema.optional(Schema.String),
  labels: Labels,
  mentions: Schema.Array(Schema.String),
  taskState: Schema.optional(Schema.String),
  bookkeeping: Schema.Boolean,
  summary: Schema.String,
});

export type FeedEntry = typeof FeedSchema.Type;

export const WatcherSchema = Schema.Struct({
  watcherId: Schema.String,
  url: Schema.String,
  channel: Schema.optional(Schema.String),
  labelKey: Schema.optional(Schema.String),
  labelValue: Schema.optional(Schema.String),
  kinds: Schema.Array(Schema.Literals(["reply", "label", "task"])),
  ownerId: Schema.String,
});

export type Watcher = typeof WatcherSchema.Type;

export const ScheduleSchema = Schema.Struct({
  scheduleId: Schema.String,
  threadId: Schema.String,
  body: Schema.String,
  everyMs: Schema.optional(Schema.Number),
  generation: Schema.Number,
  ownerId: Schema.String,
  authorName: Schema.String,
  profile: Schema.optional(Schema.String),
  active: Schema.Boolean,
});

const AgentRecord = Schema.Struct({
  agentId: AgentId,
  name: Schema.String,
  harness: Schema.String,
  sessionId: Schema.optional(Schema.String),
  profile: Schema.optional(Schema.String),
  revoked: Schema.optional(Schema.Boolean),
});

const HumanRecord = Schema.Struct({
  accountId: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

const Item = Schema.Struct({
  itemId: WorkItemId,
  title: Schema.String,
  body: Schema.String,
  authorId: AgentId,
  status: Schema.Literals(["open", "claimed", "done", "failed"]),
  seq: Schema.Number,
  claimGeneration: Schema.Number,
  claimantId: Schema.optional(AgentId),
  leaseMs: Schema.optional(Schema.Number),
  failureReason: Schema.optional(Schema.String),
});

export type Item = typeof Item.Type;

const StoredMessage = Schema.Struct({
  messageId: Schema.String,
  fromAgentId: AgentId,
  body: Schema.String,
  seq: Schema.Number,
  toAgentId: Schema.optional(AgentId),
  itemId: Schema.optional(Schema.String),
});

export const ChannelSchema = Schema.Struct({
  path: Schema.String,
  isPrivate: Schema.Boolean,
  seq: Schema.Number,
});

const SchemaDoc = Schema.Struct({
  schemaId: Schema.String,
  description: Schema.String,
  document: Schema.String,
});

const PlanSchema = Schema.Struct({
  fingerprint: Schema.String,
  taskIds: Schema.Array(Schema.String),
});

export const OpenState = Schema.TaggedStruct("Open", {
  title: Schema.String,
  ownerAccountId: Schema.optional(Schema.String),
  agents: Schema.Record(Schema.String, AgentRecord),
  humans: Schema.Record(Schema.String, HumanRecord),
  items: Schema.Record(Schema.String, Item),
  messages: Schema.Array(StoredMessage),
  threads: Schema.Record(Schema.String, MessageSchema),
  tasks: Schema.Record(Schema.String, TaskSchema),
  channels: Schema.Record(Schema.String, ChannelSchema),
  grants: Schema.Array(GrantSchema),
  nextGrant: Schema.Number,
  schemas: Schema.Record(Schema.String, SchemaDoc),
  watchers: Schema.Array(WatcherSchema),
  schedules: Schema.Record(Schema.String, ScheduleSchema),
  plans: Schema.Record(Schema.String, PlanSchema),
  feed: Schema.Array(FeedSchema),
  nextSeq: Schema.Number,
});

export const State = Schema.Union([Schema.TaggedStruct("Unopened", {}), OpenState]);

export type State = typeof State.Type;

export type Open = Extract<State, { _tag: "Open" }>;
