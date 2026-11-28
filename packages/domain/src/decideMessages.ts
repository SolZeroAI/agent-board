import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { Actor } from "./Actor.ts";
import { actorId } from "./Actor.ts";
import type { Open, State } from "./boardState.ts";
import { jsonSchemaError } from "./jsonSchema.ts";
import {
  AttachmentAdded,
  ChannelCreated,
  LabelsChanged,
  MessageDeleted,
  MessageEdited,
  MessagePosted,
  ReactionAdded,
  ReactionRemoved,
  TaskBlocked,
  TaskCanceled,
  WatchersMatched,
} from "./parity.commands.ts";
import {
  Forbidden,
  InvalidAttachment,
  InvalidChannel,
  InvalidLabel,
  InvalidMessage,
  NotAuthor,
  SchemaInvalid,
  UnknownMessage,
  UnknownSchema,
} from "./rejections.ts";
import {
  allowed,
  asOpen,
  authored,
  onBoard,
  ownsMessage,
  taskLabel,
  watcherUrls,
} from "./scope.ts";
import {
  ATTACHMENT_COUNT,
  ATTACHMENT_MAX,
  blank,
  labelError,
  mentionsIn,
  MESSAGE_MAX,
  messageCursor,
  validChannel,
} from "./text.ts";
import { CurrentActor } from "./CurrentActor.ts";

const context = (
  state: State,
  boardId: string,
  channel: string,
  permission: "read" | "post" | "react" | "label" | "manage",
) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    const open = asOpen(state);

    if (open instanceof Error || open._tag !== "Open") return yield* open;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const grant = allowed(open, actor, channel, permission);

    if (grant !== undefined) return yield* grant;
    const createdAt = yield* Clock.currentTimeMillis;

    return { open, actor, createdAt };
  });

const labelsOk = (labels: Readonly<Record<string, string>> | undefined) => {
  if (labels === undefined) return undefined;

  for (const [key, value] of Object.entries(labels)) {
    const problem = labelError(key, value);

    if (problem !== undefined) return new InvalidLabel({ key: problem });
  }

  return undefined;
};

const attachmentsOk = (
  attachments: ReadonlyArray<{ readonly name: string; readonly dataBase64: string }> | undefined,
) => {
  if (attachments === undefined) return undefined;

  if (attachments.length > ATTACHMENT_COUNT) return new InvalidAttachment();

  for (const attachment of attachments) {
    if (
      blank(attachment.name) ||
      Math.floor((attachment.dataBase64.length * 3) / 4) > ATTACHMENT_MAX
    ) {
      return new InvalidAttachment();
    }
  }

  return undefined;
};

const channelEvent = (open: Open, path: string, seq: number) =>
  open.channels[path] === undefined ? [new ChannelCreated({ path, isPrivate: false, seq })] : [];

export const decidePost = (
  state: State,
  cmd: {
    readonly channel: string;
    readonly body: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly schemaId?: string;
    readonly dataJson?: string;
    readonly attachments?: ReadonlyArray<{
      readonly attachmentId: string;
      readonly name: string;
      readonly mediaType: string;
      readonly dataBase64: string;
    }>;
  },
  boardId: string,
) =>
  Effect.gen(function* () {
    if (!validChannel(cmd.channel)) return yield* new InvalidChannel();
    const ready = yield* context(state, boardId, cmd.channel, "post");

    if (!("open" in ready)) return ready;
    const { open, actor, createdAt } = ready;

    if (blank(cmd.body) || cmd.body.length > MESSAGE_MAX) return yield* new InvalidMessage();
    const badLabels = labelsOk(cmd.labels);

    if (badLabels !== undefined) return yield* badLabels;
    const badFiles = attachmentsOk(cmd.attachments);

    if (badFiles !== undefined) return yield* badFiles;
    let dataJson = cmd.dataJson;

    if (cmd.schemaId !== undefined) {
      const schema = open.schemas[cmd.schemaId];

      if (schema === undefined) return yield* new UnknownSchema();
      const parsed = yield* Effect.try({
        try: () => JSON.parse(cmd.dataJson ?? ""),
        catch: () => new SchemaInvalid({ reason: "data is not json" }),
      });

      if (parsed instanceof SchemaInvalid) return yield* parsed;
      const reason = jsonSchemaError(JSON.parse(schema.document), parsed);

      if (reason !== undefined) return yield* new SchemaInvalid({ reason });
      dataJson = cmd.dataJson;
    }

    const seq = open.nextSeq;
    const messageId = messageCursor(seq);
    const labels = cmd.labels ?? {};
    const posted = new MessagePosted({
      messageId,
      channel: cmd.channel,
      threadId: messageId,
      body: cmd.body,
      authorId: actorId(actor),
      authorName: actor.name,
      ...(actor.profile === undefined ? {} : { profile: actor.profile }),
      labels,
      mentions: mentionsIn(cmd.body),
      ...(cmd.schemaId === undefined ? {} : { schemaId: cmd.schemaId }),
      ...(dataJson === undefined ? {} : { dataJson }),
      createdAt,
      seq,
    });
    const files = (cmd.attachments ?? []).map(
      (attachment) =>
        new AttachmentAdded({
          messageId,
          attachment,
          ...authored(actor, createdAt),
        }),
    );
    const urls = watcherUrls(open, "reply", cmd.channel, labels);

    return [
      ...channelEvent(open, cmd.channel, seq),
      posted,
      ...files,
      ...(urls.length === 0
        ? []
        : [new WatchersMatched({ urls, summary: cmd.body.slice(0, 140) })]),
    ];
  });

export const decideReply = (
  state: State,
  cmd: {
    readonly messageId: string;
    readonly body: string;
    readonly attachments?: ReadonlyArray<{
      readonly attachmentId: string;
      readonly name: string;
      readonly mediaType: string;
      readonly dataBase64: string;
    }>;
  },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const parent = open.threads[cmd.messageId];

    if (parent === undefined) return yield* new UnknownMessage();
    const ready = yield* context(state, boardId, parent.channel, "post");

    if (!("open" in ready)) return ready;
    const { actor, createdAt } = ready;

    if (blank(cmd.body) || cmd.body.length > MESSAGE_MAX) return yield* new InvalidMessage();
    const badFiles = attachmentsOk(cmd.attachments);

    if (badFiles !== undefined) return yield* badFiles;
    const seq = ready.open.nextSeq;
    const messageId = messageCursor(seq);
    const posted = new MessagePosted({
      messageId,
      channel: parent.channel,
      threadId: parent.threadId,
      body: cmd.body,
      authorId: actorId(actor),
      authorName: actor.name,
      ...(actor.profile === undefined ? {} : { profile: actor.profile }),
      labels: {},
      mentions: mentionsIn(cmd.body),
      createdAt,
      seq,
    });
    const files = (cmd.attachments ?? []).map(
      (attachment) => new AttachmentAdded({ messageId, attachment, ...authored(actor, createdAt) }),
    );
    const urls = watcherUrls(ready.open, "reply", parent.channel, parent.labels);

    return [
      posted,
      ...files,
      ...(urls.length === 0
        ? []
        : [new WatchersMatched({ urls, summary: cmd.body.slice(0, 140) })]),
    ];
  });

const editable = (open: Open, actor: Actor, messageId: string, boardAllowsOwnerDelete: boolean) => {
  const message = open.threads[messageId];

  if (message === undefined || message.deleted) return new UnknownMessage();

  if (ownsMessage(message, actor)) return message;

  if (boardAllowsOwnerDelete && actor._tag === "Human" && actor.role === "owner") return message;

  return new NotAuthor();
};

export const decideEdit = (
  state: State,
  cmd: { readonly messageId: string; readonly body: string },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const current = open.threads[cmd.messageId];

    if (current === undefined) return yield* new UnknownMessage();
    const ready = yield* context(state, boardId, current.channel, "post");

    if (!("open" in ready)) return ready;

    if (blank(cmd.body) || cmd.body.length > MESSAGE_MAX) return yield* new InvalidMessage();
    const message = editable(ready.open, ready.actor, cmd.messageId, false);

    if (message instanceof UnknownMessage || message instanceof NotAuthor) return yield* message;
    const edited = new MessageEdited({
      messageId: cmd.messageId,
      body: cmd.body,
      mentions: mentionsIn(cmd.body),
      ...authored(ready.actor, ready.createdAt),
    });
    const task = ready.open.tasks[message.threadId];
    const stranger =
      !ownsMessage(message, ready.actor) ||
      (ready.actor.profile !== undefined && message.profile !== ready.actor.profile);

    if (
      task !== undefined &&
      task.state !== "completed" &&
      task.state !== "canceled" &&
      stranger &&
      message.messageId === message.threadId
    ) {
      return [
        edited,
        new TaskBlocked({
          taskId: task.taskId,
          kind: "edited",
          prompt: "the task text changed",
          createdAt: ready.createdAt,
        }),
      ];
    }

    return [edited];
  });

export const decideDelete = (state: State, cmd: { readonly messageId: string }, boardId: string) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const current = open.threads[cmd.messageId];

    if (current === undefined) return yield* new UnknownMessage();
    const ready = yield* context(state, boardId, current.channel, "post");

    if (!("open" in ready)) return ready;
    const message = editable(ready.open, ready.actor, cmd.messageId, true);

    if (message instanceof UnknownMessage || message instanceof NotAuthor) return yield* message;
    const deleted = new MessageDeleted({
      messageId: cmd.messageId,
      ...authored(ready.actor, ready.createdAt),
    });
    const task = ready.open.tasks[message.threadId];

    if (
      task !== undefined &&
      message.messageId === message.threadId &&
      task.state !== "completed" &&
      task.state !== "canceled"
    ) {
      return [
        deleted,
        new TaskCanceled({
          taskId: task.taskId,
          reason: "root deleted",
          createdAt: ready.createdAt,
        }),
      ];
    }

    return [deleted];
  });

export const decideLabels = (
  state: State,
  cmd: {
    readonly messageId: string;
    readonly set?: Readonly<Record<string, string>>;
    readonly unset?: ReadonlyArray<string>;
  },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const message = open.threads[cmd.messageId];

    if (message === undefined) return yield* new UnknownMessage();
    const ready = yield* context(state, boardId, message.channel, "label");

    if (!("open" in ready)) return ready;
    const bad = labelsOk(cmd.set);

    if (bad !== undefined) return yield* bad;

    for (const key of cmd.unset ?? []) {
      if (labelError(key, "x") !== undefined || key.startsWith("board.")) {
        return yield* new InvalidLabel({ key });
      }
    }

    const labels = { ...message.labels, ...cmd.set };

    for (const key of cmd.unset ?? []) delete labels[key];
    if (message.labels["board.task"] !== undefined)
      labels["board.task"] = message.labels["board.task"];
    const changed = new LabelsChanged({
      messageId: cmd.messageId,
      labels,
      ...authored(ready.actor, ready.createdAt),
    });
    const urls = watcherUrls(ready.open, "label", message.channel, labels);

    return [
      changed,
      ...(urls.length === 0 ? [] : [new WatchersMatched({ urls, summary: "labels" })]),
    ];
  });

export const decideReact = (
  state: State,
  cmd: { readonly messageId: string; readonly emoji: string },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const message = open.threads[cmd.messageId];

    if (message === undefined || message.deleted) return yield* new UnknownMessage();
    const ready = yield* context(state, boardId, message.channel, "react");

    if (!("open" in ready)) return ready;

    if (blank(cmd.emoji) || cmd.emoji.length > 32) return yield* new InvalidMessage();
    const id = actorId(ready.actor);
    const exists = message.reactions.some(
      (reaction) => reaction.emoji === cmd.emoji && reaction.actorId === id,
    );
    const event = exists
      ? new ReactionRemoved({
          messageId: cmd.messageId,
          emoji: cmd.emoji,
          ...authored(ready.actor, ready.createdAt),
        })
      : new ReactionAdded({
          messageId: cmd.messageId,
          emoji: cmd.emoji,
          ...authored(ready.actor, ready.createdAt),
        });

    return [event];
  });

export const decideAttach = (
  state: State,
  cmd: {
    readonly messageId: string;
    readonly attachment: {
      readonly attachmentId: string;
      readonly name: string;
      readonly mediaType: string;
      readonly dataBase64: string;
    };
  },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const message = open.threads[cmd.messageId];

    if (message === undefined || message.deleted) return yield* new UnknownMessage();
    const ready = yield* context(state, boardId, message.channel, "post");

    if (!("open" in ready)) return ready;
    const owner = editable(ready.open, ready.actor, cmd.messageId, false);

    if (owner instanceof UnknownMessage || owner instanceof NotAuthor) return yield* owner;
    const bad = attachmentsOk([cmd.attachment]);

    if (bad !== undefined) return yield* bad;

    if (message.attachments.length >= ATTACHMENT_COUNT) return yield* new InvalidAttachment();

    return [
      new AttachmentAdded({
        messageId: cmd.messageId,
        attachment: cmd.attachment,
        ...authored(ready.actor, ready.createdAt),
      }),
    ];
  });

export const labelFor = taskLabel;

export const forbid = Forbidden;
