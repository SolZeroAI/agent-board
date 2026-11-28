// @ts-nocheck
import { useSyncExternalStore } from "react";

import { compileAccess } from "./access.ts";
import { listing } from "./listing.ts";
import * as store from "./store.ts";
import { setupPrompt, type Harness } from "./setupPrompt.ts";
import {
  BoardError,
  type Attachment,
  type BoardEventView,
  type ChannelView,
  type Explanation,
  type GrantInput,
  type InboxEntry,
  type Me,
  type MessageView,
  type SchemaInput,
  type SyncedView,
} from "./types.ts";
import { said } from "./words.ts";
import { toast } from "./chrome.ts";

export const named = false;
export type Profile = { name: string; avatar?: string };
export const getProfile = () => profile;
export const needsName = () => false;
export const avatarOf = (_name: string) => undefined;

let profile: Profile | null | undefined;
let boardId = "";
let person: Me | null = null;
let state = store.initialState;
const listeners = new Set<() => void>();
const written = new Set<string>();

const set = (next: (state: store.State) => store.State) => {
  const updated = next(state);

  if (updated === state) return;

  state = updated;

  for (const listener of listeners) listener();
};

export function useBoard(): store.State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export const getState = () => state;
export const getPerson = () => person;
export const getBoardId = () => boardId;

export function viewerOf(me: Me): store.Viewer {
  const access = compileAccess(me.can);

  return {
    actor: me.actor,
    principal: me.principal,
    profile: me.profile,
    may: (permission, channel) => access.can(permission, channel),
    manages: access.at("manage", "*"),
  };
}

const call = async (name: string, target: string, input: unknown) => {
  const response = await fetch(`/api/${name}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, input }),
  });
  const text = await response.text();

  if (!response.ok) throw new BoardError(text, response.status);

  return JSON.parse(text) as { reply: Record<string, unknown> };
};

type ApiMessage = {
  messageId: string;
  channel: string;
  threadId: string;
  body: string;
  authorId: string;
  authorName: string;
  profile?: string;
  labels: Record<string, string>;
  reactions: Array<{ emoji: string; actorId: string }>;
  deleted: boolean;
  seq: number;
  createdAt: number;
};

const toMessage = (message: ApiMessage): MessageView => {
  const reactions: Record<string, string[]> = {};

  for (const reaction of message.reactions ?? []) {
    reactions[reaction.emoji] = [...(reactions[reaction.emoji] ?? []), reaction.actorId];
  }

  return {
    id: message.messageId,
    text: message.deleted ? "" : message.body,
    deleted: message.deleted,
    reactions,
    labels: message.labels ?? {},
    channel: message.channel,
    re: message.threadId === message.messageId ? null : message.threadId,
    version: message.seq,
    by: { actor: message.authorId },
    author: { name: message.authorName },
    createdAt: new Date(message.createdAt).toISOString(),
    from: null,
    ...(message.profile === undefined ? {} : { schedule: undefined }),
  };
};

const ensureBoard = async () => {
  if (boardId !== "") return boardId;

  const listed = await call("ReadBoards", "team", {});
  const boards = (listed.reply.boards ?? []) as Array<{ boardId: string; title: string }>;
  const newest = boards.at(-1);

  if (newest === undefined) throw new BoardError("Open a board before reading it");

  boardId = newest.boardId;

  return boardId;
};

const loadMe = async (): Promise<Me> => {
  const who = await call("WhoAmI", "team", {});
  const reply = who.reply as {
    actorId: string;
    name: string;
    kind: string;
    profile?: string;
    role?: string;
  };
  const owner = reply.role === "owner" || reply.kind === "human";

  return {
    actor: reply.actorId,
    principal: reply.actorId,
    profile: reply.profile ?? null,
    handle: reply.name,
    name: reply.name,
    can: owner
      ? [{ pattern: "*", permissions: ["read", "post", "react", "label", "manage"] }]
      : [{ pattern: "*", permissions: ["read", "post", "react", "label"] }],
  };
};

export async function setProfile(next: Profile | null | undefined): Promise<boolean> {
  profile = next;

  try {
    const me = await loadMe();

    person = me;
    set((current) => ({ ...current, me: { ...me, profile: next?.name ?? null } }));

    return true;
  } catch (error) {
    toast(`couldn't switch: ${said(error)}`);

    return false;
  }
}

const readChannel = async (channel: string) => {
  const page = await call("ReadChannel", await ensureBoard(), { channel });

  return ((page.reply.messages ?? []) as ApiMessage[]).map(toMessage);
};

const listed = listing(
  {
    threads: async () => ({ threads: [] }),
    messages: async (channel) => ({ messages: await readChannel(channel) }),
  },
  () => state,
  set,
);

const loaded = new Map<string, Promise<void>>();

const once = (key: string, load: () => Promise<void>) => {
  let promise = loaded.get(key);

  if (!promise) {
    promise = load().catch((error) => {
      loaded.delete(key);
      toast(said(error));
    });
    loaded.set(key, promise);
  }

  return promise;
};

const live = new Set<(event: BoardEventView) => void>();
let watching = false;

export function onLive(listener: (event: BoardEventView) => void) {
  live.add(listener);

  return () => live.delete(listener);
}

export const wroteHere = (message: MessageView) => written.has(message.id);

export async function boot() {
  const me = await loadMe();
  const id = await ensureBoard();
  const catalog = await call("ReadChannels", id, {});
  const channels = Object.fromEntries(
    ((catalog.reply.channels ?? []) as Array<{ path: string }>).map((channel) => [
      channel.path,
      { path: channel.path } satisfies ChannelView,
    ]),
  );

  person = me;
  set((current) => ({ ...current, me, channels, discovery: { name: "Agent Board", sync: [] } }));
  const events: BoardEventView[] = [];

  for (const channel of Object.values(channels)) {
    for (const message of await readChannel(channel.path)) {
      events.push({
        type: "message.posted",
        cursor: message.id,
        message,
        payload: { channel: channel.path },
      });
    }
  }

  listed.apply(events);
  set((current) => ({
    ...current,
    live: "live",
    cursor: events.at(-1)?.cursor ?? "",
    tasksCounted: true,
  }));
  const source = new EventSource(`/tail?board=${encodeURIComponent(id)}`);

  const pull = async () => {
    const nextCatalog = await call("ReadChannels", id, {});
    const nextChannels = Object.fromEntries(
      ((nextCatalog.reply.channels ?? []) as Array<{ path: string }>).map((channel) => [
        channel.path,
        { path: channel.path } satisfies ChannelView,
      ]),
    );
    const messages: MessageView[] = [];

    for (const channel of Object.values(nextChannels))
      messages.push(...(await readChannel(channel.path)));

    set((current) => {
      const merged = store.merge(current, messages);

      return {
        ...merged,
        channels: { ...current.channels, ...nextChannels },
        cursor: messages.at(-1)?.id ?? current.cursor ?? "",
        live: "live",
      };
    });
  };

  source.onmessage = (event) => {
    const parsed = JSON.parse(event.data) as {
      cursor?: string;
      channel?: string;
      summary?: string;
      type?: string;
    };
    const view: BoardEventView = {
      type:
        parsed.type === "message.posted" || parsed.type === "MessagePosted"
          ? "message.posted"
          : (parsed.type ?? "event"),
      cursor: parsed.cursor ?? "",
      payload: { channel: parsed.channel },
    };

    for (const listener of live) listener(view);

    if (parsed.channel !== undefined) void pull();
  };
  source.onerror = () => set((current) => ({ ...current, live: "reconnecting" }));

  if (!watching) {
    watching = true;
    setInterval(() => {
      void pull().catch(() => undefined);
    }, 2000);
  }
}

export const loadChannel = (channel: string) =>
  once(`channel:${channel}`, () => listed.load(channel));

export async function loadOlder(_channel: string) {
  return false;
}

export const loadThread = (id: string) =>
  once(`thread:${id}`, async () => {
    const page = await call("ReadThread", await ensureBoard(), { messageId: id });
    const messages = ((page.reply.messages ?? []) as ApiMessage[]).map(toMessage);

    set((current) => store.merge(current, messages));
  });

export const loadInbox = async (_key: string): Promise<InboxEntry[]> => [];

export const loadFiltered = async (channel: string | undefined, _filter: store.Filter) => {
  if (channel !== undefined) await loadChannel(channel);
};

const fail = (key: string, error: unknown) =>
  set((current) => ({
    ...current,
    pending: current.pending.map((post) =>
      post.key === key ? { ...post, error: said(error) } : post,
    ),
  }));

export async function send(
  post: {
    channel: string;
    re: string | null;
    text: string;
    noSync: boolean;
    labels: Record<string, string>;
    files?: File[];
    task?: store.Pending["task"];
    later?: store.Pending["later"];
  },
  key: string = crypto.randomUUID(),
) {
  set((current) => ({
    ...current,
    pending: [
      ...current.pending.filter((item) => item.key !== key),
      {
        key,
        channel: post.channel,
        re: post.re,
        text: post.text,
        noSync: post.noSync,
        labels: post.labels,
        createdAt: new Date().toISOString(),
        error: null,
        ...(post.later === undefined ? {} : { later: post.later }),
        ...(post.task === undefined ? {} : { task: post.task }),
      },
    ],
  }));

  try {
    const id = await ensureBoard();
    const name = post.re === null ? "PostMessage" : "ReplyMessage";
    const input =
      post.re === null
        ? {
            channel: post.channel,
            body: post.text,
            ...(Object.keys(post.labels).length > 0 ? { labels: post.labels } : {}),
          }
        : { messageId: post.re, body: post.text };
    const receipt = await call(name, id, input);
    const messageId = String(receipt.reply.messageId ?? "");

    written.add(messageId);
    const messages = await readChannel(post.channel);
    const message = messages.find((item) => item.id === messageId) ?? messages.at(-1);

    if (message !== undefined) set((current) => store.sent(current, key, message));
  } catch (error) {
    fail(key, error);
  }
}

export const retry = (pending: store.Pending) =>
  send(
    {
      channel: pending.channel,
      re: pending.re,
      text: pending.text,
      noSync: pending.noSync,
      labels: pending.labels,
      ...(pending.later === undefined ? {} : { later: pending.later }),
      ...(pending.task === undefined ? {} : { task: pending.task }),
    },
    pending.key,
  );

export const discard = (key: string) =>
  set((current) => ({ ...current, pending: current.pending.filter((post) => post.key !== key) }));

const change = async (id: string, op: store.Op, run: () => Promise<void>) => {
  const token = crypto.randomUUID();

  set((current) => store.addOp(current, id, token, op));

  try {
    await run();
    set((current) => store.dropOp(current, id, token));
  } catch (error) {
    set((current) => store.dropOp(current, id, token));
    toast(said(error));
  }
};

export const react = (id: string, emoji: string, remove: boolean) =>
  change(id, { kind: "react", emoji, remove }, async () => {
    await call("ReactToMessage", await ensureBoard(), { messageId: id, emoji, remove });
  });

export const edit = (id: string, text: string) =>
  change(id, { kind: "edit", text }, async () => {
    await call("EditMessage", await ensureBoard(), { messageId: id, body: text });
  });

export const remove = (id: string) =>
  change(id, { kind: "delete" }, async () => {
    await call("DeleteMessage", await ensureBoard(), { messageId: id });
  });

export const label = (id: string, put: Record<string, string>, unset: string[]) =>
  change(id, { kind: "label", set: put, unset }, async () => {
    await call("SetLabels", await ensureBoard(), { messageId: id, set: put, unset });
  });

export async function attachmentUrl(_id: string) {
  return "";
}

export async function saveAttachment(_attachment: Attachment) {}

export async function loadTasks(_filter: store.TaskFilter, _after?: string) {
  const page = await call("ReadTasks", await ensureBoard(), {});
  const tasks = (page.reply.tasks ?? []) as Array<Record<string, unknown>>;

  return {
    cursor: "",
    last: undefined,
    more: false,
    refused: tasks.length < 0 ? "" : undefined,
    tooWide: false,
  };
}

export async function claimTask(_id: string) {
  return false;
}

export const renewTask = async (_id: string) => {};
export const releaseTask = async (_id: string) => {};
export const completeTask = async (_id: string, _result?: string) => {};
export const failTask = async (_id: string, _reason: string) => {};
export const blockTask = async (_id: string, _reason: string, _kind?: string) => {};
export const unblockTask = async (_id: string) => {};
export const reopenTask = async (_id: string) => {};
export const assignTask = async (_id: string, _actor: string | null) => {};
export const cancelTask = async (_id: string, _reason: string) => {};
export const makeTask = async (
  _re: string,
  _options: { needs: string[]; for: string | null },
) => {};

export async function loadSchemas() {
  const page = await call("ReadSchemas", await ensureBoard(), {});

  set((current) => ({ ...current, schemas: (page.reply.schemas ?? []) as store.State["schemas"] }));
}

export const findSchema = (id: string) => once(`schema:${id}`, loadSchemas);

export async function registerSchema(input: SchemaInput) {
  const page = await call("RegisterSchema", await ensureBoard(), input);

  await loadSchemas();

  return String(page.reply.schemaId ?? "");
}

export async function loadGrants() {
  const page = await call("ReadGrants", await ensureBoard(), {});

  set((current) => ({
    ...current,
    grants: { is: "ready", items: (page.reply.grants ?? []) as never[] },
  }));
}

export async function createGrant(input: GrantInput) {
  const page = await call("CreateGrant", await ensureBoard(), input);

  await loadGrants();

  return String(page.reply.grantId ?? "");
}

export async function revokeGrant(id: string) {
  await call("RevokeGrant", await ensureBoard(), { grantId: id });
  await loadGrants();
}

export const explain = async (
  channel: string,
  _whom: Record<string, string> = {},
): Promise<Explanation> => {
  const page = await call("ExplainAccess", await ensureBoard(), { channel });

  return page.reply as Explanation;
};

export async function loadSchedules(_all = false) {
  set((current) => ({ ...current, schedules: { is: "ready", items: [] }, everySchedule: _all }));
}

export async function cancelSchedule(_id: string) {}

export async function loadWatchers() {
  set((current) => ({ ...current, watchers: { is: "ready", items: [] } }));
}

export async function loadSynced(_id: string): Promise<SyncedView["targets"]> {
  return [];
}

export async function createChannel(path: string, options: { private?: boolean } = {}) {
  await call("CreateChannel", await ensureBoard(), { path, isPrivate: options.private === true });
  await boot();

  return true;
}

export async function registerAgent(input: {
  agentName: string;
  harness: string;
  boardId?: string;
}) {
  const id = input.boardId ?? (await ensureBoard());
  const response = await fetch("/agents", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentName: input.agentName, harness: input.harness, boardId: id }),
  });
  const text = await response.text();

  if (!response.ok) throw new BoardError(text, response.status);

  const created = JSON.parse(text) as { token: string; agentId: string; boardId: string };

  return {
    ...created,
    prompt: setupPrompt({
      origin: location.origin,
      token: created.token,
      boardId: created.boardId,
      harness: input.harness as Harness,
    }),
  };
}
