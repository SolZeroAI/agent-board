import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { AttachmentSchema, FeedSchema, Labels, MessageSchema, TaskSchema } from "./boardState.ts";
import { BoardId } from "./ids.ts";
import { PERMISSIONS } from "./grants.ts";
import {
  ChannelExists,
  ChannelTreeTooLarge,
  ClaimLost,
  Forbidden,
  IdempotencyConflict,
  InvalidAttachment,
  InvalidChannel,
  InvalidLabel,
  InvalidMessage,
  InvalidPlan,
  InvalidSchedule,
  InvalidWatcher,
  InvalidWork,
  NotAuthor,
  NotMember,
  NothingReady,
  SchemaInvalid,
  TaskNotOwned,
  TaskState,
  UnknownAttachment,
  UnknownGrant,
  UnknownMessage,
  UnknownSchema,
  UnknownTask,
  BoardClosed,
  InvalidLease,
} from "./rejections.ts";
import { Session } from "./Session.ts";

const PermissionSchema = Schema.Literals(PERMISSIONS);

export const PrincipalInput = Schema.Union([
  Schema.TaggedStruct("User", { email: Schema.String }),
  Schema.TaggedStruct("Agent", { agentId: Schema.String }),
  Schema.TaggedStruct("AllUsers", {}),
  Schema.TaggedStruct("AllAgents", {}),
  Schema.TaggedStruct("Everyone", {}),
]);

const actorFields = {
  actorId: Schema.String,
  actorName: Schema.String,
  profile: Schema.optional(Schema.String),
  createdAt: Schema.Finite,
};

export class ChannelCreated extends Domain.Event("ChannelCreated", {
  path: Schema.String,
  isPrivate: Schema.Boolean,
  seq: Schema.Finite,
}) {}

export class MessagePosted extends Domain.Event("MessagePosted", {
  messageId: Schema.String,
  channel: Schema.String,
  threadId: Schema.String,
  body: Schema.String,
  authorId: Schema.String,
  authorName: Schema.String,
  profile: Schema.optional(Schema.String),
  labels: Labels,
  mentions: Schema.Array(Schema.String),
  schemaId: Schema.optional(Schema.String),
  dataJson: Schema.optional(Schema.String),
  createdAt: Schema.Finite,
  seq: Schema.Finite,
}) {}

export class MessageEdited extends Domain.Event("MessageEdited", {
  messageId: Schema.String,
  body: Schema.String,
  mentions: Schema.Array(Schema.String),
  ...actorFields,
}) {}

export class MessageDeleted extends Domain.Event("MessageDeleted", {
  messageId: Schema.String,
  ...actorFields,
}) {}

export class LabelsChanged extends Domain.Event("LabelsChanged", {
  messageId: Schema.String,
  labels: Labels,
  ...actorFields,
}) {}

export class ReactionAdded extends Domain.Event("ReactionAdded", {
  messageId: Schema.String,
  emoji: Schema.String,
  ...actorFields,
}) {}

export class ReactionRemoved extends Domain.Event("ReactionRemoved", {
  messageId: Schema.String,
  emoji: Schema.String,
  ...actorFields,
}) {}

export class AttachmentAdded extends Domain.Event("AttachmentAdded", {
  messageId: Schema.String,
  attachment: AttachmentSchema,
  ...actorFields,
}) {}

export class SchemaRegistered extends Domain.Event("SchemaRegistered", {
  schemaId: Schema.String,
  description: Schema.String,
  document: Schema.String,
}) {}

export class GrantCreated extends Domain.Event("GrantCreated", {
  grantId: Schema.String,
  principals: Schema.Array(PrincipalInput),
  pattern: Schema.String,
  permissions: Schema.Array(PermissionSchema),
}) {}

export class GrantRevoked extends Domain.Event("GrantRevoked", { grantId: Schema.String }) {}

const taskFields = {
  taskId: Schema.String,
  channel: Schema.String,
  ...actorFields,
};

export class TaskCreated extends Domain.Event("TaskCreated", {
  ...taskFields,
  state: Schema.Literals(["waiting", "ready"]),
  ownerId: Schema.String,
  ownerProfile: Schema.optional(Schema.String),
  assignee: Schema.optional(Schema.String),
  needs: Schema.Array(Schema.String),
  seq: Schema.Finite,
  text: Schema.String,
}) {}

export class TaskReady extends Domain.Event("TaskReady", { taskId: Schema.String }) {}

export class TaskClaimed extends Domain.Event("TaskClaimed", {
  taskId: Schema.String,
  claimantId: Schema.String,
  claimantProfile: Schema.optional(Schema.String),
  leaseMs: Schema.Finite,
  claimGeneration: Schema.Finite,
  createdAt: Schema.Finite,
}) {}

export class TaskRenewed extends Domain.Event("TaskRenewed", {
  taskId: Schema.String,
  leaseMs: Schema.Finite,
  claimGeneration: Schema.Finite,
  createdAt: Schema.Finite,
}) {}

export class TaskReleased extends Domain.Event("TaskReleased", {
  taskId: Schema.String,
  createdAt: Schema.Finite,
}) {}

export class TaskCompleted extends Domain.Event("TaskCompleted", {
  taskId: Schema.String,
  result: Schema.String,
  createdAt: Schema.Finite,
}) {}

export class TaskFailed extends Domain.Event("TaskFailed", {
  taskId: Schema.String,
  reason: Schema.String,
  createdAt: Schema.Finite,
}) {}

export class TaskBlocked extends Domain.Event("TaskBlocked", {
  taskId: Schema.String,
  kind: Schema.String,
  prompt: Schema.String,
  createdAt: Schema.Finite,
}) {}

export class TaskUnblocked extends Domain.Event("TaskUnblocked", {
  taskId: Schema.String,
  state: Schema.Literals(["waiting", "ready"]),
  createdAt: Schema.Finite,
}) {}

export class TaskCanceled extends Domain.Event("TaskCanceled", {
  taskId: Schema.String,
  reason: Schema.String,
  createdAt: Schema.Finite,
}) {}

export class TaskReopened extends Domain.Event("TaskReopened", {
  taskId: Schema.String,
  state: Schema.Literals(["waiting", "ready"]),
  createdAt: Schema.Finite,
}) {}

export class TaskAssigned extends Domain.Event("TaskAssigned", {
  taskId: Schema.String,
  assignee: Schema.optional(Schema.String),
  createdAt: Schema.Finite,
}) {}

export class TaskNeedsChanged extends Domain.Event("TaskNeedsChanged", {
  taskId: Schema.String,
  needs: Schema.Array(Schema.String),
  state: Schema.Literals(["waiting", "ready"]),
  createdAt: Schema.Finite,
}) {}

export class TaskExpired extends Domain.Event("TaskExpired", {
  taskId: Schema.String,
  claimGeneration: Schema.Finite,
}) {}

export class WatcherRegistered extends Domain.Event("WatcherRegistered", {
  watcherId: Schema.String,
  url: Schema.String,
  channel: Schema.optional(Schema.String),
  labelKey: Schema.optional(Schema.String),
  labelValue: Schema.optional(Schema.String),
  kinds: Schema.Array(Schema.Literals(["reply", "label", "task"])),
  ownerId: Schema.String,
}) {}

export class WatcherRemoved extends Domain.Event("WatcherRemoved", { watcherId: Schema.String }) {}

export class WatchersMatched extends Domain.Event("WatchersMatched", {
  urls: Schema.Array(Schema.String),
  summary: Schema.String,
}) {}

export class FollowUpScheduled extends Domain.Event("FollowUpScheduled", {
  scheduleId: Schema.String,
  threadId: Schema.String,
  body: Schema.String,
  inMs: Schema.optional(Schema.Finite),
  everyMs: Schema.optional(Schema.Finite),
  generation: Schema.Finite,
  ownerId: Schema.String,
  authorName: Schema.String,
  profile: Schema.optional(Schema.String),
}) {}

export class FollowUpCanceled extends Domain.Event("FollowUpCanceled", {
  scheduleId: Schema.String,
}) {}

export class FollowUpDelivered extends Domain.Event("FollowUpDelivered", {
  scheduleId: Schema.String,
  generation: Schema.Finite,
}) {}

export class PlanNoted extends Domain.Event("PlanNoted", {
  idempotencyKey: Schema.String,
  fingerprint: Schema.String,
  taskIds: Schema.Array(Schema.String),
}) {}

export class ReadMarked extends Domain.Event("ReadMarked", {
  kind: Schema.Literals([
    "feed",
    "channel",
    "thread",
    "tasks",
    "channels",
    "attachment",
    "explain",
    "actors",
    "schemas",
    "grants",
  ]),
  channel: Schema.optional(Schema.String),
  messageId: Schema.optional(Schema.String),
  labelKey: Schema.optional(Schema.String),
  labelValue: Schema.optional(Schema.String),
  mention: Schema.optional(Schema.String),
  entryType: Schema.optional(Schema.String),
  after: Schema.optional(Schema.String),
  taskState: Schema.optional(Schema.String),
  includeBookkeeping: Schema.Boolean,
  actorJson: Schema.String,
}) {}

const session = [Session];

const PlanTask = Schema.Struct({
  key: Schema.optional(Schema.String),
  text: Schema.String,
  labels: Schema.optional(Labels),
  needs: Schema.optional(Schema.Array(Schema.String)),
  for: Schema.optional(Schema.String),
});

export class CreateChannel extends Domain.Command("CreateChannel", {
  target: BoardId,
  middleware: session,
  input: { path: Schema.String, isPrivate: Schema.Boolean },
  events: [ChannelCreated, GrantCreated],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, ChannelExists],
  reply: { path: Schema.String },
}) {}

export class PostMessage extends Domain.Command("PostMessage", {
  target: BoardId,
  middleware: session,
  input: {
    channel: Schema.String,
    body: Schema.String,
    labels: Schema.optional(Labels),
    schemaId: Schema.optional(Schema.String),
    dataJson: Schema.optional(Schema.String),
    attachments: Schema.optional(Schema.Array(AttachmentSchema)),
  },
  events: [ChannelCreated, MessagePosted, AttachmentAdded, WatchersMatched],
  rejects: [
    BoardClosed,
    NotMember,
    Forbidden,
    InvalidChannel,
    InvalidMessage,
    InvalidLabel,
    UnknownSchema,
    SchemaInvalid,
    InvalidAttachment,
  ],
  reply: { messageId: Schema.String, seq: Schema.Finite, cursor: Schema.String },
}) {}

export class ReplyMessage extends Domain.Command("ReplyMessage", {
  target: BoardId,
  middleware: session,
  input: {
    messageId: Schema.String,
    body: Schema.String,
    attachments: Schema.optional(Schema.Array(AttachmentSchema)),
  },
  events: [MessagePosted, AttachmentAdded, WatchersMatched],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownMessage, InvalidMessage, InvalidAttachment],
  reply: { messageId: Schema.String, seq: Schema.Finite, cursor: Schema.String },
}) {}

export class EditMessage extends Domain.Command("EditMessage", {
  target: BoardId,
  middleware: session,
  input: { messageId: Schema.String, body: Schema.String },
  events: [MessageEdited, TaskBlocked],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownMessage, NotAuthor, InvalidMessage],
  reply: { messageId: Schema.String },
}) {}

export class DeleteMessage extends Domain.Command("DeleteMessage", {
  target: BoardId,
  middleware: session,
  input: { messageId: Schema.String },
  events: [MessageDeleted, TaskCanceled],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownMessage, NotAuthor],
  reply: { messageId: Schema.String },
}) {}

export class SetLabels extends Domain.Command("SetLabels", {
  target: BoardId,
  middleware: session,
  input: {
    messageId: Schema.String,
    set: Schema.optional(Labels),
    unset: Schema.optional(Schema.Array(Schema.String)),
  },
  events: [LabelsChanged, WatchersMatched],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownMessage, InvalidLabel],
  reply: { messageId: Schema.String },
}) {}

export class ReactToMessage extends Domain.Command("ReactToMessage", {
  target: BoardId,
  middleware: session,
  input: { messageId: Schema.String, emoji: Schema.String },
  events: [ReactionAdded, ReactionRemoved],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownMessage, InvalidMessage],
  reply: { messageId: Schema.String, added: Schema.Boolean },
}) {}

export class AddAttachment extends Domain.Command("AddAttachment", {
  target: BoardId,
  middleware: session,
  input: { messageId: Schema.String, attachment: AttachmentSchema },
  events: [AttachmentAdded],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownMessage, InvalidAttachment, NotAuthor],
  reply: { attachmentId: Schema.String },
}) {}

export class RegisterSchema extends Domain.Command("RegisterSchema", {
  target: BoardId,
  middleware: session,
  input: { schemaId: Schema.String, description: Schema.String, document: Schema.String },
  events: [SchemaRegistered],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidWork, SchemaInvalid],
  reply: { schemaId: Schema.String },
}) {}

export class CreateGrant extends Domain.Command("CreateGrant", {
  target: BoardId,
  middleware: session,
  input: {
    principals: Schema.Array(PrincipalInput),
    pattern: Schema.String,
    permissions: Schema.Array(PermissionSchema),
  },
  events: [GrantCreated],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel],
  reply: { grantId: Schema.String },
}) {}

export class RevokeGrant extends Domain.Command("RevokeGrant", {
  target: BoardId,
  middleware: session,
  input: { grantId: Schema.String },
  events: [GrantRevoked],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownGrant],
  reply: { grantId: Schema.String },
}) {}

const taskRejects = [
  BoardClosed,
  NotMember,
  Forbidden,
  UnknownTask,
  TaskState,
  ClaimLost,
  TaskNotOwned,
  InvalidLease,
  InvalidWork,
  NothingReady,
  InvalidChannel,
  InvalidLabel,
  InvalidPlan,
  IdempotencyConflict,
  UnknownMessage,
  ChannelTreeTooLarge,
] as const;

export class CreateTask extends Domain.Command("CreateTask", {
  target: BoardId,
  middleware: session,
  input: {
    channel: Schema.String,
    text: Schema.String,
    labels: Schema.optional(Labels),
    needs: Schema.optional(Schema.Array(Schema.String)),
    for: Schema.optional(Schema.String),
    idempotencyKey: Schema.optional(Schema.String),
  },
  events: [ChannelCreated, MessagePosted, TaskCreated, PlanNoted, TaskReady, WatchersMatched],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String, created: Schema.Boolean },
}) {}

export class CreatePlan extends Domain.Command("CreatePlan", {
  target: BoardId,
  middleware: session,
  input: {
    channel: Schema.String,
    idempotencyKey: Schema.String,
    tasks: Schema.Array(PlanTask),
  },
  events: [ChannelCreated, MessagePosted, TaskCreated, PlanNoted, TaskReady, WatchersMatched],
  rejects: [...taskRejects],
  reply: { taskIds: Schema.Array(Schema.String), created: Schema.Boolean },
}) {}

export class MakeTask extends Domain.Command("MakeTask", {
  target: BoardId,
  middleware: session,
  input: { messageId: Schema.String },
  events: [TaskCreated, LabelsChanged],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String },
}) {}

export class ClaimTask extends Domain.Command("ClaimTask", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String, leaseMs: Schema.Finite },
  events: [TaskClaimed, LabelsChanged, WatchersMatched],
  rejects: [...taskRejects],
  reply: { task: Schema.NullOr(TaskSchema) },
}) {}

export class ClaimReady extends Domain.Command("ClaimReady", {
  target: BoardId,
  middleware: session,
  input: {
    channel: Schema.String,
    leaseMs: Schema.Finite,
    labelKey: Schema.optional(Schema.String),
    labelValue: Schema.optional(Schema.String),
    from: Schema.optional(Schema.Array(Schema.String)),
  },
  events: [TaskClaimed, LabelsChanged, WatchersMatched],
  rejects: [...taskRejects],
  reply: { task: Schema.NullOr(TaskSchema) },
}) {}

export class RenewTask extends Domain.Command("RenewTask", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String, leaseMs: Schema.Finite },
  events: [TaskRenewed],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String, claimGeneration: Schema.Finite },
}) {}

export class CompleteTask extends Domain.Command("CompleteTask", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String, result: Schema.String },
  events: [TaskCompleted, TaskFailed, TaskReleased, TaskReady, LabelsChanged, WatchersMatched],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String },
}) {}

export class FailTask extends Domain.Command("FailTask", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String, reason: Schema.String },
  events: [TaskCompleted, TaskFailed, TaskReleased, TaskReady, LabelsChanged, WatchersMatched],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String },
}) {}

export class ReleaseTask extends Domain.Command("ReleaseTask", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String },
  events: [TaskCompleted, TaskFailed, TaskReleased, TaskReady, LabelsChanged, WatchersMatched],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String },
}) {}

export class BlockTask extends Domain.Command("BlockTask", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String, prompt: Schema.String, kind: Schema.String },
  events: [TaskBlocked, LabelsChanged, WatchersMatched],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String },
}) {}

export class UnblockTask extends Domain.Command("UnblockTask", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String },
  events: [TaskUnblocked, LabelsChanged],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String },
}) {}

export class CancelTask extends Domain.Command("CancelTask", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String, reason: Schema.String },
  events: [TaskCanceled, LabelsChanged, WatchersMatched],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String },
}) {}

export class ReopenTask extends Domain.Command("ReopenTask", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String },
  events: [TaskReopened, LabelsChanged],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String },
}) {}

export class AssignTask extends Domain.Command("AssignTask", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String, assignee: Schema.optional(Schema.String), pool: Schema.Boolean },
  events: [TaskAssigned],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String },
}) {}

export class SetTaskNeeds extends Domain.Command("SetTaskNeeds", {
  target: BoardId,
  middleware: session,
  input: { taskId: Schema.String, needs: Schema.Array(Schema.String) },
  events: [TaskNeedsChanged, LabelsChanged],
  rejects: [...taskRejects],
  reply: { taskId: Schema.String },
}) {}

/** The lease ran out. Scheduled by the board, never by a client. */
export class ExpireTask extends Domain.Command("ExpireTask", {
  target: BoardId,
  input: { taskId: Schema.String, claimGeneration: Schema.Finite },
  events: [TaskExpired, LabelsChanged],
}) {}

export class RegisterWatcher extends Domain.Command("RegisterWatcher", {
  target: BoardId,
  middleware: session,
  input: {
    watcherId: Schema.String,
    url: Schema.String,
    channel: Schema.optional(Schema.String),
    labelKey: Schema.optional(Schema.String),
    labelValue: Schema.optional(Schema.String),
    kinds: Schema.Array(Schema.Literals(["reply", "label", "task"])),
  },
  events: [WatcherRegistered],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidWatcher, InvalidChannel],
  reply: { watcherId: Schema.String },
}) {}

export class RemoveWatcher extends Domain.Command("RemoveWatcher", {
  target: BoardId,
  middleware: session,
  input: { watcherId: Schema.String },
  events: [WatcherRemoved],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownMessage],
  reply: { watcherId: Schema.String },
}) {}

export class ScheduleFollowUp extends Domain.Command("ScheduleFollowUp", {
  target: BoardId,
  middleware: session,
  input: {
    threadId: Schema.String,
    body: Schema.String,
    inMs: Schema.optional(Schema.Finite),
    everyMs: Schema.optional(Schema.Finite),
  },
  events: [FollowUpScheduled],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownMessage, InvalidSchedule, InvalidMessage],
  reply: { scheduleId: Schema.String },
}) {}

export class CancelFollowUp extends Domain.Command("CancelFollowUp", {
  target: BoardId,
  middleware: session,
  input: { scheduleId: Schema.String },
  events: [FollowUpCanceled],
  rejects: [BoardClosed, NotMember, Forbidden, UnknownMessage],
  reply: { scheduleId: Schema.String },
}) {}

export class DeliverFollowUp extends Domain.Command("DeliverFollowUp", {
  target: BoardId,
  input: {
    scheduleId: Schema.String,
    generation: Schema.Finite,
  },
  events: [MessagePosted, FollowUpDelivered, FollowUpScheduled, WatchersMatched],
}) {}

export class ReadFeed extends Domain.Command("ReadFeed", {
  target: BoardId,
  middleware: session,
  input: {
    after: Schema.optional(Schema.String),
    channel: Schema.optional(Schema.String),
    labelKey: Schema.optional(Schema.String),
    labelValue: Schema.optional(Schema.String),
    mention: Schema.optional(Schema.String),
    entryType: Schema.optional(Schema.String),
    includeBookkeeping: Schema.optional(Schema.Boolean),
  },
  events: [ReadMarked],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, UnknownMessage, UnknownAttachment],
  reply: { events: Schema.Array(FeedSchema), cursor: Schema.String },
}) {}

export class ReadChannel extends Domain.Command("ReadChannel", {
  target: BoardId,
  middleware: session,
  input: {
    channel: Schema.String,
    labelKey: Schema.optional(Schema.String),
    labelValue: Schema.optional(Schema.String),
    after: Schema.optional(Schema.String),
  },
  events: [ReadMarked],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, UnknownMessage, UnknownAttachment],
  reply: { messages: Schema.Array(MessageSchema), cursor: Schema.String },
}) {}

export class ReadThread extends Domain.Command("ReadThread", {
  target: BoardId,
  middleware: session,
  input: { messageId: Schema.String },
  events: [ReadMarked],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, UnknownMessage, UnknownAttachment],
  reply: { messages: Schema.Array(MessageSchema), task: Schema.NullOr(TaskSchema) },
}) {}

export class ReadTasks extends Domain.Command("ReadTasks", {
  target: BoardId,
  middleware: session,
  input: {
    channel: Schema.optional(Schema.String),
    taskState: Schema.optional(Schema.String),
    labelKey: Schema.optional(Schema.String),
    labelValue: Schema.optional(Schema.String),
  },
  events: [ReadMarked],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, UnknownMessage, UnknownAttachment],
  reply: { tasks: Schema.Array(TaskSchema) },
}) {}

export class ReadChannels extends Domain.Command("ReadChannels", {
  target: BoardId,
  middleware: session,
  input: {},
  events: [ReadMarked],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, UnknownMessage, UnknownAttachment],
  reply: {
    channels: Schema.Array(Schema.Struct({ path: Schema.String, isPrivate: Schema.Boolean })),
  },
}) {}

export class ReadAttachment extends Domain.Command("ReadAttachment", {
  target: BoardId,
  middleware: session,
  input: { attachmentId: Schema.String },
  events: [ReadMarked],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, UnknownMessage, UnknownAttachment],
  reply: {
    attachmentId: Schema.String,
    name: Schema.String,
    mediaType: Schema.String,
    dataBase64: Schema.String,
  },
}) {}

export class ExplainAccess extends Domain.Command("ExplainAccess", {
  target: BoardId,
  middleware: session,
  input: { channel: Schema.String, email: Schema.optional(Schema.String) },
  events: [ReadMarked],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, UnknownMessage, UnknownAttachment],
  reply: {
    permissions: Schema.Array(PermissionSchema),
    grantIds: Schema.Array(Schema.String),
  },
}) {}

export class ReadActors extends Domain.Command("ReadActors", {
  target: BoardId,
  middleware: session,
  input: {},
  events: [ReadMarked],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, UnknownMessage, UnknownAttachment],
  reply: {
    actors: Schema.Array(
      Schema.Struct({
        actorId: Schema.String,
        name: Schema.String,
        kind: Schema.Literals(["human", "agent"]),
        email: Schema.optional(Schema.String),
      }),
    ),
  },
}) {}

export class ReadSchemas extends Domain.Command("ReadSchemas", {
  target: BoardId,
  middleware: session,
  input: {},
  events: [ReadMarked],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, UnknownMessage, UnknownAttachment],
  reply: {
    schemas: Schema.Array(
      Schema.Struct({
        schemaId: Schema.String,
        description: Schema.String,
        document: Schema.String,
      }),
    ),
  },
}) {}

export class ReadGrants extends Domain.Command("ReadGrants", {
  target: BoardId,
  middleware: session,
  input: {},
  events: [ReadMarked],
  rejects: [BoardClosed, NotMember, Forbidden, InvalidChannel, UnknownMessage, UnknownAttachment],
  reply: {
    grants: Schema.Array(
      Schema.Struct({
        grantId: Schema.String,
        pattern: Schema.String,
        permissions: Schema.Array(PermissionSchema),
        principals: Schema.Array(PrincipalInput),
      }),
    ),
  },
}) {}
