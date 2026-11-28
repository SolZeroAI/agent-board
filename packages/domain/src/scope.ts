import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { Actor, actorId } from "./Actor.ts";
import type { FeedEntry, Message, Open, State, Task } from "./boardState.ts";
import { can, isTeamOwner, type Permission } from "./grants.ts";
import { BoardClosed, Forbidden, NotMember } from "./rejections.ts";
import { cursorOf } from "./text.ts";

export const asOpen = (state: State) => (state._tag === "Open" ? state : new BoardClosed());

/** Agents must belong to this board. Humans are team members and then meet grants. */
export const onBoard = (open: Open, actor: Actor, boardId: string) => {
  if (
    actor._tag === "Agent" &&
    (actor.boardId !== boardId || open.agents[actor.agentId] === undefined)
  ) {
    return new NotMember();
  }

  return undefined;
};

export const allowed = (open: Open, actor: Actor, channel: string, permission: Permission) => {
  if (permission === "manage" && isTeamOwner(actor)) return undefined;

  if (!can(open.grants, actor, channel, permission)) return new Forbidden({ action: permission });

  return undefined;
};

export const authored = (actor: Actor, createdAt: number) => ({
  actorId: actorId(actor),
  actorName: actor.name,
  createdAt,
  ...(actor.profile === undefined ? {} : { profile: actor.profile }),
});

export const snapshot = (actor: Actor) => JSON.stringify(actor);

export const actorFrom = (json: string) =>
  Option.getOrUndefined(Schema.decodeOption(Schema.fromJsonString(Actor))(json));

export const withFeed = (
  open: Open,
  entry: Omit<FeedEntry, "cursor" | "labels" | "mentions" | "bookkeeping"> & {
    readonly cursor?: string;
    readonly labels?: FeedEntry["labels"];
    readonly mentions?: ReadonlyArray<string>;
    readonly bookkeeping?: boolean;
  },
): Open => ({
  ...open,
  nextSeq: Math.max(open.nextSeq, entry.seq + 1),
  feed: [
    ...open.feed,
    {
      cursor: entry.cursor ?? cursorOf(entry.seq),
      seq: entry.seq,
      type: entry.type,
      createdAt: entry.createdAt,
      actorId: entry.actorId,
      actorName: entry.actorName,
      ...(entry.profile === undefined ? {} : { profile: entry.profile }),
      ...(entry.channel === undefined ? {} : { channel: entry.channel }),
      ...(entry.messageId === undefined ? {} : { messageId: entry.messageId }),
      labels: entry.labels ?? {},
      mentions: [...(entry.mentions ?? [])],
      ...(entry.taskState === undefined ? {} : { taskState: entry.taskState }),
      bookkeeping: entry.bookkeeping ?? false,
      summary: entry.summary,
    },
  ],
});

export const taskLabel = (labels: Message["labels"], state: string): Message["labels"] => ({
  ...labels,
  "board.task": state,
});

export const rootOf = (open: Open, messageId: string) => {
  const message = open.threads[messageId];

  if (message === undefined) return undefined;

  return open.threads[message.threadId];
};

export const ownsMessage = (message: Message, actor: Actor) => {
  if (message.authorId !== actorId(actor)) return false;

  if (actor.profile === undefined) return true;

  return message.profile === actor.profile;
};

export const ownsTask = (task: Task, actor: Actor) => {
  if (task.ownerId !== actorId(actor)) return false;

  if (actor.profile === undefined) return true;

  return task.ownerProfile === actor.profile;
};

export const watcherUrls = (
  open: Open,
  kind: "reply" | "label" | "task",
  channel: string,
  labels: Message["labels"],
) =>
  open.watchers
    .filter((watcher) => {
      if (!watcher.kinds.includes(kind)) return false;

      if (watcher.channel !== undefined) {
        const pattern = watcher.channel.endsWith("/") ? watcher.channel : `${watcher.channel}`;
        const matches = pattern.endsWith("/")
          ? channel === pattern.slice(0, -1) || channel.startsWith(pattern)
          : channel === pattern;

        if (!matches) return false;
      }

      if (watcher.labelKey !== undefined && labels[watcher.labelKey] !== watcher.labelValue) {
        return false;
      }

      return true;
    })
    .map((watcher) => watcher.url);
