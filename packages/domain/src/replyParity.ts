import type { Actor } from "./Actor.ts";
import type { FeedEntry, Message, Open, State } from "./boardState.ts";
import { can } from "./grants.ts";
import type { ReadMarked } from "./parity.commands.ts";
import { actorFrom } from "./scope.ts";
import { seqOf, subtree } from "./text.ts";

const marked = (events: ReadonlyArray<{ readonly _tag: string }>) => {
  const found = events.find((event) => event._tag === "ReadMarked");

  return found !== undefined && found._tag === "ReadMarked" ? (found as ReadMarked) : undefined;
};

const reader = (event: ReadMarked | undefined) =>
  event === undefined ? undefined : actorFrom(event.actorJson);

const visibleChannel = (open: Open, actor: Actor, channel: string) =>
  can(open.grants, actor, channel, "read");

const feedOk = (entry: FeedEntry, open: Open, actor: Actor, event: ReadMarked) => {
  if (!event.includeBookkeeping && entry.bookkeeping) return false;

  if (entry.channel !== undefined && !visibleChannel(open, actor, entry.channel)) return false;

  if (
    event.channel !== undefined &&
    (entry.channel === undefined || !subtree(event.channel, entry.channel))
  ) {
    return false;
  }

  if (event.labelKey !== undefined && entry.labels[event.labelKey] !== event.labelValue)
    return false;

  if (event.mention !== undefined && !entry.mentions.includes(event.mention)) return false;

  if (event.entryType !== undefined && entry.type !== event.entryType) return false;
  const after = event.after === undefined ? undefined : seqOf(event.after);

  if (after !== undefined && entry.seq <= after) return false;

  return true;
};

export const replyFeed = (state: State, events: ReadonlyArray<{ readonly _tag: string }>) => {
  const event = marked(events);
  const actor = reader(event);

  if (state._tag !== "Open" || event === undefined || actor === undefined) {
    return { events: [], cursor: "" };
  }

  const visible = state.feed.filter((entry) => feedOk(entry, state, actor, event));
  const last = state.feed.at(-1);

  return { events: visible, cursor: last?.cursor ?? "" };
};

const messageVisible = (message: Message, open: Open, actor: Actor) =>
  visibleChannel(open, actor, message.channel);

export const replyChannel = (state: State, events: ReadonlyArray<{ readonly _tag: string }>) => {
  const event = marked(events);
  const actor = reader(event);

  if (state._tag !== "Open" || event?.channel === undefined || actor === undefined) {
    return { messages: [], cursor: "" };
  }

  const messages = Object.values(state.threads).filter(
    (message) =>
      subtree(event.channel ?? "", message.channel) &&
      messageVisible(message, state, actor) &&
      (event.labelKey === undefined || message.labels[event.labelKey] === event.labelValue) &&
      (event.after === undefined || message.seq > (seqOf(event.after) ?? 0)),
  );

  return {
    messages: messages.sort((left, right) => left.seq - right.seq),
    cursor: state.feed.at(-1)?.cursor ?? "",
  };
};

export const replyThread = (state: State, events: ReadonlyArray<{ readonly _tag: string }>) => {
  const event = marked(events);
  const actor = reader(event);
  const root =
    event?.messageId === undefined || state._tag !== "Open"
      ? undefined
      : state.threads[event.messageId];

  if (
    root === undefined ||
    actor === undefined ||
    state._tag !== "Open" ||
    !messageVisible(root, state, actor)
  ) {
    return { messages: [], task: null };
  }

  const messages = Object.values(state.threads)
    .filter((message) => message.threadId === root.threadId)
    .sort((left, right) => left.seq - right.seq);

  return { messages, task: state.tasks[root.threadId] ?? null };
};

export const replyTasks = (state: State, events: ReadonlyArray<{ readonly _tag: string }>) => {
  const event = marked(events);
  const actor = reader(event);

  if (state._tag !== "Open" || actor === undefined) return { tasks: [] };
  const tasks = Object.values(state.tasks).filter((task) => {
    if (!visibleChannel(state, actor, task.channel)) return false;

    if (event?.channel !== undefined && !subtree(event.channel, task.channel)) return false;

    if (
      event?.taskState !== undefined &&
      event.taskState !== "all" &&
      task.state !== event.taskState
    ) {
      return false;
    }

    if (
      event?.taskState === undefined &&
      (task.state === "completed" || task.state === "canceled" || task.state === "failed")
    ) {
      return false;
    }

    const message = state.threads[task.taskId];

    if (event?.labelKey !== undefined && message?.labels[event.labelKey] !== event.labelValue)
      return false;

    return true;
  });

  return { tasks: tasks.sort((left, right) => left.seq - right.seq) };
};

export const replyChannels = (state: State, events: ReadonlyArray<{ readonly _tag: string }>) => {
  const actor = reader(marked(events));

  if (state._tag !== "Open" || actor === undefined) return { channels: [] };

  return {
    channels: Object.values(state.channels)
      .filter((channel) => visibleChannel(state, actor, channel.path))
      .map((channel) => ({ path: channel.path, isPrivate: channel.isPrivate })),
  };
};

export const replyAttachment = (state: State, events: ReadonlyArray<{ readonly _tag: string }>) => {
  const event = marked(events);
  const actor = reader(event);
  const empty = { attachmentId: "", name: "", mediaType: "", dataBase64: "" };

  if (state._tag !== "Open" || actor === undefined || event?.messageId === undefined) return empty;

  for (const message of Object.values(state.threads)) {
    const found = message.attachments.find((item) => item.attachmentId === event.messageId);

    if (found !== undefined && messageVisible(message, state, actor)) return found;
  }

  return empty;
};

export const replyActors = (state: State) => {
  if (state._tag !== "Open") return { actors: [] };
  const humans = Object.values(state.humans).map((human) => ({
    actorId: human.accountId,
    name: human.name,
    kind: "human" as const,
    email: human.email,
  }));
  const agents = Object.values(state.agents).map((agent) => ({
    actorId: agent.agentId,
    name: agent.name,
    kind: "agent" as const,
  }));

  return { actors: [...humans, ...agents] };
};

export const replySchemas = (state: State) => ({
  schemas: state._tag === "Open" ? Object.values(state.schemas) : [],
});

export const replyGrants = (state: State) => ({
  grants:
    state._tag === "Open"
      ? state.grants.map((grant) => ({
          grantId: grant.grantId,
          pattern: grant.pattern,
          permissions: [...grant.permissions],
          principals: [...grant.principals],
        }))
      : [],
});

export const explain = (state: State, events: ReadonlyArray<{ readonly _tag: string }>) => {
  const event = marked(events);
  const actor = reader(event);

  if (state._tag !== "Open" || actor === undefined || event?.channel === undefined) {
    return { permissions: [], grantIds: [] };
  }

  const allowed = (["read", "post", "react", "label", "manage"] as const).filter((permission) =>
    can(state.grants, actor, event.channel ?? "", permission),
  );
  const grantIds = state.grants
    .filter((grant) => grant.pattern === "*" || grant.pattern === event.channel)
    .map((grant) => grant.grantId);

  return { permissions: allowed, grantIds };
};
