import type { Message, Open, State, Task } from "./boardState.ts";
import type {
  AttachmentAdded,
  ChannelCreated,
  FollowUpCanceled,
  FollowUpDelivered,
  FollowUpScheduled,
  GrantCreated,
  GrantRevoked,
  LabelsChanged,
  MessageDeleted,
  MessageEdited,
  MessagePosted,
  PlanNoted,
  ReactionAdded,
  ReactionRemoved,
  SchemaRegistered,
  TaskAssigned,
  TaskBlocked,
  TaskCanceled,
  TaskClaimed,
  TaskCompleted,
  TaskCreated,
  TaskExpired,
  TaskFailed,
  TaskNeedsChanged,
  TaskReady,
  TaskRenewed,
  TaskReopened,
  TaskReleased,
  TaskUnblocked,
  WatcherRegistered,
  WatcherRemoved,
} from "./parity.commands.ts";
import { taskLabel, withFeed } from "./scope.ts";

const keep = (state: State, fn: (open: Open) => Open): State =>
  state._tag === "Open" ? fn(state) : state;

const messageOf = (event: typeof MessagePosted.Type): Message => ({
  messageId: event.messageId,
  channel: event.channel,
  threadId: event.threadId,
  body: event.body,
  authorId: event.authorId,
  authorName: event.authorName,
  ...(event.profile === undefined ? {} : { profile: event.profile }),
  labels: event.labels,
  mentions: [...event.mentions],
  reactions: [],
  attachments: [],
  ...(event.schemaId === undefined ? {} : { schemaId: event.schemaId }),
  ...(event.dataJson === undefined ? {} : { dataJson: event.dataJson }),
  deleted: false,
  seq: event.seq,
  createdAt: event.createdAt,
});

const relabel = (open: Open, messageId: string, labels: Message["labels"]) => {
  const message = open.threads[messageId];

  if (message === undefined) return open;

  return {
    ...open,
    threads: { ...open.threads, [messageId]: { ...message, labels } },
  };
};

const retask = (open: Open, taskId: string, patch: Partial<Task>) => {
  const task = open.tasks[taskId];

  if (task === undefined) return open;

  return { ...open, tasks: { ...open.tasks, [taskId]: { ...task, ...patch } } };
};

export const foldChannelCreated = (state: State, event: typeof ChannelCreated.Type) =>
  keep(state, (open) =>
    withFeed(
      {
        ...open,
        channels: {
          ...open.channels,
          [event.path]: { path: event.path, isPrivate: event.isPrivate, seq: event.seq },
        },
      },
      {
        seq: event.seq,
        type: "channel.created",
        createdAt: event.seq,
        actorId: "board",
        actorName: "board",
        channel: event.path,
        summary: `channel ${event.path}`,
      },
    ),
  );

export const foldMessagePosted = (state: State, event: typeof MessagePosted.Type) =>
  keep(state, (open) =>
    withFeed(
      {
        ...open,
        threads: { ...open.threads, [event.messageId]: messageOf(event) },
      },
      {
        seq: event.seq,
        cursor: event.messageId,
        type: "message.posted",
        createdAt: event.createdAt,
        actorId: event.authorId,
        actorName: event.authorName,
        ...(event.profile === undefined ? {} : { profile: event.profile }),
        channel: event.channel,
        messageId: event.messageId,
        labels: event.labels,
        mentions: event.mentions,
        ...(event.labels["board.task"] === undefined
          ? {}
          : { taskState: event.labels["board.task"] }),
        summary: event.body.slice(0, 140),
      },
    ),
  );

export const foldMessageEdited = (state: State, event: typeof MessageEdited.Type) =>
  keep(state, (open) => {
    const message = open.threads[event.messageId];

    if (message === undefined) return open;
    const next = { ...message, body: event.body, mentions: [...event.mentions] };

    return withFeed(
      { ...open, threads: { ...open.threads, [event.messageId]: next } },
      {
        seq: open.nextSeq,
        type: "message.edited",
        createdAt: event.createdAt,
        actorId: event.actorId,
        actorName: event.actorName,
        ...(event.profile === undefined ? {} : { profile: event.profile }),
        channel: message.channel,
        messageId: event.messageId,
        labels: message.labels,
        mentions: event.mentions,
        summary: event.body.slice(0, 140),
      },
    );
  });

export const foldMessageDeleted = (state: State, event: typeof MessageDeleted.Type) =>
  keep(state, (open) => {
    const message = open.threads[event.messageId];

    if (message === undefined) return open;
    const next = { ...message, body: "", deleted: true, mentions: [] };

    return withFeed(
      { ...open, threads: { ...open.threads, [event.messageId]: next } },
      {
        seq: open.nextSeq,
        type: "message.deleted",
        createdAt: event.createdAt,
        actorId: event.actorId,
        actorName: event.actorName,
        ...(event.profile === undefined ? {} : { profile: event.profile }),
        channel: message.channel,
        messageId: event.messageId,
        summary: "deleted",
      },
    );
  });

export const foldLabels = (state: State, event: typeof LabelsChanged.Type) =>
  keep(state, (open) => {
    const message = open.threads[event.messageId];

    if (message === undefined) return open;

    return withFeed(relabel(open, event.messageId, event.labels), {
      seq: open.nextSeq,
      type: "labels.changed",
      createdAt: event.createdAt,
      actorId: event.actorId,
      actorName: event.actorName,
      ...(event.profile === undefined ? {} : { profile: event.profile }),
      channel: message.channel,
      messageId: event.messageId,
      labels: event.labels,
      ...(event.labels["board.task"] === undefined
        ? {}
        : { taskState: event.labels["board.task"] }),
      bookkeeping: event.actorId === "board",
      summary: "labels",
    });
  });

const react = (
  state: State,
  event: {
    readonly messageId: string;
    readonly emoji: string;
    readonly actorId: string;
    readonly actorName: string;
    readonly profile?: string;
    readonly createdAt: number;
  },
  added: boolean,
) =>
  keep(state, (open) => {
    const message = open.threads[event.messageId];

    if (message === undefined) return open;
    const reactions = added
      ? [...message.reactions, { emoji: event.emoji, actorId: event.actorId }]
      : message.reactions.filter(
          (reaction) => reaction.emoji !== event.emoji || reaction.actorId !== event.actorId,
        );

    return withFeed(
      {
        ...open,
        threads: { ...open.threads, [event.messageId]: { ...message, reactions } },
      },
      {
        seq: open.nextSeq,
        type: added ? "reaction.added" : "reaction.removed",
        createdAt: event.createdAt,
        actorId: event.actorId,
        actorName: event.actorName,
        ...(event.profile === undefined ? {} : { profile: event.profile }),
        channel: message.channel,
        messageId: event.messageId,
        labels: message.labels,
        summary: event.emoji,
      },
    );
  });

export const foldReactionAdded = (state: State, event: typeof ReactionAdded.Type) =>
  react(state, event, true);

export const foldReactionRemoved = (state: State, event: typeof ReactionRemoved.Type) =>
  react(state, event, false);

export const foldAttachment = (state: State, event: typeof AttachmentAdded.Type) =>
  keep(state, (open) => {
    const message = open.threads[event.messageId];

    if (message === undefined) return open;

    return withFeed(
      {
        ...open,
        threads: {
          ...open.threads,
          [event.messageId]: {
            ...message,
            attachments: [...message.attachments, event.attachment],
          },
        },
      },
      {
        seq: open.nextSeq,
        type: "attachment.added",
        createdAt: event.createdAt,
        actorId: event.actorId,
        actorName: event.actorName,
        channel: message.channel,
        messageId: event.messageId,
        summary: event.attachment.name,
      },
    );
  });

export const foldSchema = (state: State, event: typeof SchemaRegistered.Type) =>
  keep(state, (open) => ({
    ...open,
    schemas: {
      ...open.schemas,
      [event.schemaId]: {
        schemaId: event.schemaId,
        description: event.description,
        document: event.document,
      },
    },
  }));

export const foldGrantCreated = (state: State, event: typeof GrantCreated.Type) =>
  keep(state, (open) => ({
    ...open,
    nextGrant: open.nextGrant + 1,
    grants: [
      ...open.grants,
      {
        grantId: event.grantId,
        principals: [...event.principals],
        pattern: event.pattern,
        permissions: [...event.permissions],
      },
    ],
  }));

export const foldGrantRevoked = (state: State, event: typeof GrantRevoked.Type) =>
  keep(state, (open) => ({
    ...open,
    grants: open.grants.filter((grant) => grant.grantId !== event.grantId),
  }));

export const foldTaskCreated = (state: State, event: typeof TaskCreated.Type) =>
  keep(state, (open) => {
    const task: Task = {
      taskId: event.taskId,
      channel: event.channel,
      state: event.state,
      ownerId: event.ownerId,
      ...(event.ownerProfile === undefined ? {} : { ownerProfile: event.ownerProfile }),
      ...(event.assignee === undefined ? {} : { assignee: event.assignee }),
      needs: [...event.needs],
      claimGeneration: 0,
      seq: event.seq,
    };
    const labeled = relabel(
      open,
      event.taskId,
      taskLabel(open.threads[event.taskId]?.labels ?? {}, event.state),
    );

    return withFeed(
      { ...labeled, tasks: { ...labeled.tasks, [event.taskId]: task } },
      {
        seq: event.seq,
        cursor: event.taskId,
        type: "task.created",
        createdAt: event.createdAt,
        actorId: event.actorId,
        actorName: event.actorName,
        ...(event.profile === undefined ? {} : { profile: event.profile }),
        channel: event.channel,
        messageId: event.taskId,
        labels: taskLabel({}, event.state),
        taskState: event.state,
        summary: event.text.slice(0, 140),
      },
    );
  });

const taskFeed = (
  open: Open,
  taskId: string,
  type: string,
  createdAt: number,
  summary: string,
  actorId = "board",
  actorName = "board",
) => {
  const task = open.tasks[taskId];

  if (task === undefined) return open;

  return withFeed(open, {
    seq: open.nextSeq,
    type,
    createdAt,
    actorId,
    actorName,
    channel: task.channel,
    messageId: taskId,
    labels: open.threads[taskId]?.labels ?? {},
    taskState: task.state,
    bookkeeping: type === "task.renewed",
    summary,
  });
};

export const foldTaskReady = (state: State, event: typeof TaskReady.Type) =>
  keep(state, (open) =>
    taskFeed(
      retask(open, event.taskId, { state: "ready" }),
      event.taskId,
      "task.ready",
      open.nextSeq,
      "ready",
    ),
  );

export const foldTaskClaimed = (state: State, event: typeof TaskClaimed.Type) =>
  keep(state, (open) =>
    taskFeed(
      retask(open, event.taskId, {
        state: "claimed",
        claimantId: event.claimantId,
        ...(event.claimantProfile === undefined ? {} : { claimantProfile: event.claimantProfile }),
        leaseMs: event.leaseMs,
        claimGeneration: event.claimGeneration,
      }),
      event.taskId,
      "task.claimed",
      event.createdAt,
      "claimed",
      event.claimantId,
      event.claimantId,
    ),
  );

export const foldTaskRenewed = (state: State, event: typeof TaskRenewed.Type) =>
  keep(state, (open) =>
    taskFeed(
      retask(open, event.taskId, {
        leaseMs: event.leaseMs,
        claimGeneration: event.claimGeneration,
      }),
      event.taskId,
      "task.renewed",
      event.createdAt,
      "renewed",
    ),
  );

export const foldTaskReleased = (state: State, event: typeof TaskReleased.Type) =>
  keep(state, (open) => {
    const task = open.tasks[event.taskId];

    if (task === undefined) return open;
    const { claimantId: _c, claimantProfile: _p, leaseMs: _l, ...rest } = task;

    return taskFeed(
      { ...open, tasks: { ...open.tasks, [event.taskId]: { ...rest, state: "ready" } } },
      event.taskId,
      "task.released",
      event.createdAt,
      "released",
    );
  });

export const foldTaskCompleted = (state: State, event: typeof TaskCompleted.Type) =>
  keep(state, (open) =>
    taskFeed(
      retask(open, event.taskId, { state: "completed", result: event.result }),
      event.taskId,
      "task.completed",
      event.createdAt,
      event.result,
    ),
  );

export const foldTaskFailed = (state: State, event: typeof TaskFailed.Type) =>
  keep(state, (open) =>
    taskFeed(
      retask(open, event.taskId, { state: "failed", reason: event.reason }),
      event.taskId,
      "task.failed",
      event.createdAt,
      event.reason,
    ),
  );

export const foldTaskBlocked = (state: State, event: typeof TaskBlocked.Type) =>
  keep(state, (open) =>
    taskFeed(
      retask(open, event.taskId, {
        state: "blocked",
        blockedKind: event.kind,
        blockedPrompt: event.prompt,
      }),
      event.taskId,
      "task.blocked",
      event.createdAt,
      event.prompt,
    ),
  );

export const foldTaskUnblocked = (state: State, event: typeof TaskUnblocked.Type) =>
  keep(state, (open) =>
    taskFeed(
      retask(open, event.taskId, { state: event.state }),
      event.taskId,
      "task.unblocked",
      event.createdAt,
      event.state,
    ),
  );

export const foldTaskCanceled = (state: State, event: typeof TaskCanceled.Type) =>
  keep(state, (open) =>
    taskFeed(
      retask(open, event.taskId, { state: "canceled", reason: event.reason }),
      event.taskId,
      "task.canceled",
      event.createdAt,
      event.reason,
    ),
  );

export const foldTaskReopened = (state: State, event: typeof TaskReopened.Type) =>
  keep(state, (open) =>
    taskFeed(
      retask(open, event.taskId, { state: event.state }),
      event.taskId,
      "task.reopened",
      event.createdAt,
      event.state,
    ),
  );

export const foldTaskAssigned = (state: State, event: typeof TaskAssigned.Type) =>
  keep(state, (open) => {
    const task = open.tasks[event.taskId];

    if (task === undefined) return open;
    const next = { ...task };

    if (event.assignee === undefined) delete next.assignee;
    else next.assignee = event.assignee;

    return taskFeed(
      { ...open, tasks: { ...open.tasks, [event.taskId]: next } },
      event.taskId,
      "task.assigned",
      event.createdAt,
      event.assignee ?? "pool",
    );
  });

export const foldTaskNeeds = (state: State, event: typeof TaskNeedsChanged.Type) =>
  keep(state, (open) =>
    taskFeed(
      retask(open, event.taskId, { needs: [...event.needs], state: event.state }),
      event.taskId,
      "task.needs_changed",
      event.createdAt,
      event.needs.join(","),
    ),
  );

export const foldTaskExpired = (state: State, event: typeof TaskExpired.Type) =>
  keep(state, (open) => {
    const task = open.tasks[event.taskId];

    if (task === undefined || task.claimGeneration !== event.claimGeneration) return open;
    const { claimantId: _c, claimantProfile: _p, leaseMs: _l, ...rest } = task;

    return taskFeed(
      { ...open, tasks: { ...open.tasks, [event.taskId]: { ...rest, state: "ready" } } },
      event.taskId,
      "task.expired",
      open.nextSeq,
      "expired",
    );
  });

export const foldWatcherRegistered = (state: State, event: typeof WatcherRegistered.Type) =>
  keep(state, (open) => ({
    ...open,
    watchers: [
      ...open.watchers.filter((watcher) => watcher.watcherId !== event.watcherId),
      {
        watcherId: event.watcherId,
        url: event.url,
        ...(event.channel === undefined ? {} : { channel: event.channel }),
        ...(event.labelKey === undefined ? {} : { labelKey: event.labelKey }),
        ...(event.labelValue === undefined ? {} : { labelValue: event.labelValue }),
        kinds: [...event.kinds],
        ownerId: event.ownerId,
      },
    ],
  }));

export const foldWatcherRemoved = (state: State, event: typeof WatcherRemoved.Type) =>
  keep(state, (open) => ({
    ...open,
    watchers: open.watchers.filter((watcher) => watcher.watcherId !== event.watcherId),
  }));

export const foldFollowScheduled = (state: State, event: typeof FollowUpScheduled.Type) =>
  keep(state, (open) => ({
    ...open,
    schedules: {
      ...open.schedules,
      [event.scheduleId]: {
        scheduleId: event.scheduleId,
        threadId: event.threadId,
        body: event.body,
        ...(event.everyMs === undefined ? {} : { everyMs: event.everyMs }),
        generation: event.generation,
        ownerId: event.ownerId,
        authorName: event.authorName,
        ...(event.profile === undefined ? {} : { profile: event.profile }),
        active: true,
      },
    },
  }));

export const foldFollowCanceled = (state: State, event: typeof FollowUpCanceled.Type) =>
  keep(state, (open) => {
    const schedule = open.schedules[event.scheduleId];

    if (schedule === undefined) return open;

    return {
      ...open,
      schedules: { ...open.schedules, [event.scheduleId]: { ...schedule, active: false } },
    };
  });

export const foldFollowDelivered = (state: State, event: typeof FollowUpDelivered.Type) =>
  keep(state, (open) => {
    const schedule = open.schedules[event.scheduleId];

    if (schedule === undefined) return open;

    return {
      ...open,
      schedules: {
        ...open.schedules,
        [event.scheduleId]: { ...schedule, generation: event.generation },
      },
    };
  });

export const foldPlan = (state: State, event: typeof PlanNoted.Type) =>
  keep(state, (open) => ({
    ...open,
    plans: {
      ...open.plans,
      [event.idempotencyKey]: {
        fingerprint: event.fingerprint,
        taskIds: [...event.taskIds],
      },
    },
  }));
