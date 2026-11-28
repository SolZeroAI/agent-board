import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { actorId } from "./Actor.ts";
import type { State } from "./boardState.ts";
import { CurrentActor } from "./CurrentActor.ts";
import { can, isTeamOwner, patternMatches, PERMISSIONS, type Permission } from "./grants.ts";
import { AccountId } from "./ids.ts";
import { jsonSchemaError } from "./jsonSchema.ts";
import { BoardOpened, HumanJoined } from "./OpenBoard.command.ts";
import {
  ChannelCreated,
  FollowUpCanceled,
  FollowUpDelivered,
  FollowUpScheduled,
  GrantCreated,
  GrantRevoked,
  MessagePosted,
  SchemaRegistered,
  WatcherRegistered,
  WatcherRemoved,
  WatchersMatched,
} from "./parity.commands.ts";
import { AlreadyOpen } from "./rejections.ts";
import {
  ChannelExists,
  Forbidden,
  InvalidChannel,
  InvalidMessage,
  InvalidSchedule,
  InvalidWatcher,
  InvalidWork,
  SchemaInvalid,
  UnknownMessage,
} from "./rejections.ts";
import { allowed, asOpen, onBoard, watcherUrls } from "./scope.ts";
import { blank, mentionsIn, messageCursor, MESSAGE_MAX, validChannel } from "./text.ts";

const account = (id: string) => Schema.decodeUnknownSync(AccountId)(id);

export const openBoard = (
  state: State,
  cmd: {
    readonly title: string;
    readonly ownerAccountId: string;
    readonly ownerName: string;
    readonly ownerEmail: string;
  },
) => {
  if (state._tag !== "Unopened") return new AlreadyOpen();

  if (blank(cmd.title) || blank(cmd.ownerName) || !cmd.ownerEmail.includes("@"))
    return new InvalidWork();
  const email = cmd.ownerEmail.trim().toLowerCase();
  const ownerAccountId = account(cmd.ownerAccountId);

  return [
    new BoardOpened({
      title: cmd.title.trim(),
      ownerAccountId,
      ownerName: cmd.ownerName.trim(),
      ownerEmail: email,
    }),
    new HumanJoined({ accountId: ownerAccountId, name: cmd.ownerName.trim(), email }),
    new GrantCreated({
      grantId: "g0",
      principals: [{ _tag: "User", email }],
      pattern: "*",
      permissions: [...PERMISSIONS],
    }),
    new GrantCreated({
      grantId: "g1",
      principals: [{ _tag: "AllUsers" }],
      pattern: "*",
      permissions: ["read", "post", "react", "label"],
    }),
    new GrantCreated({
      grantId: "g2",
      principals: [{ _tag: "AllAgents" }],
      pattern: "*",
      permissions: ["read", "post", "react", "label"],
    }),
  ];
};

const gate = (state: State, boardId: string) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;

    return { open, actor, createdAt: yield* Clock.currentTimeMillis };
  });

export const decideChannel = (
  state: State,
  cmd: { readonly path: string; readonly isPrivate: boolean },
  boardId: string,
) =>
  Effect.gen(function* () {
    if (!validChannel(cmd.path)) return yield* new InvalidChannel();
    const got = yield* gate(state, boardId);

    if (!("open" in got)) return got;

    if (
      allowed(got.open, got.actor, "general", "manage") !== undefined &&
      !isTeamOwner(got.actor)
    ) {
      return yield* new Forbidden({ action: "manage" });
    }

    const taken = Object.keys(got.open.channels).some(
      (path) =>
        path === cmd.path || path.startsWith(`${cmd.path}/`) || cmd.path.startsWith(`${path}/`),
    );

    if (taken) return yield* new ChannelExists();

    if (
      cmd.isPrivate &&
      got.open.grants.some(
        (grant) => grant.pattern !== "*" && patternMatches(grant.pattern, cmd.path),
      )
    ) {
      return yield* new ChannelExists();
    }

    const created = new ChannelCreated({
      path: cmd.path,
      isPrivate: cmd.isPrivate,
      seq: got.open.nextSeq,
    });

    if (!cmd.isPrivate || got.actor._tag !== "Human") return [created];

    return [
      new GrantCreated({
        grantId: `g${got.open.nextGrant}`,
        principals: [{ _tag: "User", email: got.actor.email }],
        pattern: cmd.path,
        permissions: ["read", "post", "react", "label"],
      }),
      new GrantCreated({
        grantId: `g${got.open.nextGrant + 1}`,
        principals: [{ _tag: "Everyone" }],
        pattern: cmd.path,
        permissions: [],
      }),
      created,
    ];
  });

const probeChannel = (pattern: string) =>
  pattern === "*" ? "general" : pattern.replace(/\/$/, "");

export const decideGrant = (
  state: State,
  cmd: {
    readonly principals: ReadonlyArray<
      | { readonly _tag: "User"; readonly email: string }
      | { readonly _tag: "Agent"; readonly agentId: string }
      | { readonly _tag: "AllUsers" }
      | { readonly _tag: "AllAgents" }
      | { readonly _tag: "Everyone" }
    >;
    readonly pattern: string;
    readonly permissions: ReadonlyArray<Permission>;
  },
  boardId: string,
) =>
  Effect.gen(function* () {
    const got = yield* gate(state, boardId);

    if (!("open" in got)) return got;
    const bare = probeChannel(cmd.pattern);

    if (cmd.pattern !== "*" && !validChannel(bare)) return yield* new InvalidChannel();
    const closing =
      cmd.permissions.length === 0 &&
      cmd.principals.some(
        (principal) => principal._tag === "Everyone" || principal._tag === "AllUsers",
      );

    if (closing && !isTeamOwner(got.actor)) return yield* new Forbidden({ action: "manage" });

    if (!isTeamOwner(got.actor)) {
      if (!can(got.open.grants, got.actor, bare, "manage"))
        return yield* new Forbidden({ action: "manage" });

      for (const permission of cmd.permissions) {
        if (!can(got.open.grants, got.actor, bare, permission)) {
          return yield* new Forbidden({ action: permission });
        }
      }
    }

    return [
      new GrantCreated({
        grantId: `g${got.open.nextGrant}`,
        principals: [...cmd.principals],
        pattern: cmd.pattern,
        permissions: [...cmd.permissions],
      }),
    ];
  });

export const decideRevoke = (state: State, cmd: { readonly grantId: string }, boardId: string) =>
  Effect.gen(function* () {
    const got = yield* gate(state, boardId);

    if (!("open" in got)) return got;
    const grant = got.open.grants.find((item) => item.grantId === cmd.grantId);

    if (grant === undefined) return yield* new Forbidden({ action: "manage" });
    const closing = grant.permissions.length === 0 || cmd.grantId === "g1";

    if (closing && !isTeamOwner(got.actor)) return yield* new Forbidden({ action: "manage" });

    if (
      !isTeamOwner(got.actor) &&
      !can(got.open.grants, got.actor, probeChannel(grant.pattern), "manage")
    ) {
      return yield* new Forbidden({ action: "manage" });
    }

    return [new GrantRevoked({ grantId: cmd.grantId })];
  });

export const decideSchema = (
  state: State,
  cmd: { readonly schemaId: string; readonly description: string; readonly document: string },
  boardId: string,
) =>
  Effect.gen(function* () {
    const got = yield* gate(state, boardId);

    if (!("open" in got)) return got;

    if (!/^[a-z0-9][a-z0-9-]*@\d+$/.test(cmd.schemaId) || blank(cmd.description)) {
      return yield* new InvalidWork();
    }

    const document = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(
      cmd.document,
    );

    if (document._tag === "None") return yield* new SchemaInvalid({ reason: "schema is not json" });

    if (
      jsonSchemaError(document.value, undefined) === "schema must be an object" ||
      typeof document.value !== "object"
    ) {
      return yield* new SchemaInvalid({ reason: "schema must be an object" });
    }

    return [
      new SchemaRegistered({
        schemaId: cmd.schemaId,
        description: cmd.description.trim(),
        document: cmd.document,
      }),
    ];
  });

const httpUrl = (value: string) => {
  const parsed = Schema.decodeUnknownOption(Schema.Unknown)(value);

  void parsed;

  return value.startsWith("https://") || value.startsWith("http://");
};

export const decideWatcher = (
  state: State,
  cmd: {
    readonly watcherId: string;
    readonly url: string;
    readonly channel?: string;
    readonly labelKey?: string;
    readonly labelValue?: string;
    readonly kinds: ReadonlyArray<"reply" | "label" | "task">;
  },
  boardId: string,
) =>
  Effect.gen(function* () {
    const got = yield* gate(state, boardId);

    if (!("open" in got)) return got;

    if (!httpUrl(cmd.url) || cmd.kinds.length === 0 || blank(cmd.watcherId)) {
      return yield* new InvalidWatcher();
    }

    if (cmd.channel !== undefined && !validChannel(cmd.channel.replace(/\/$/, ""))) {
      return yield* new InvalidChannel();
    }

    return [
      new WatcherRegistered({
        watcherId: cmd.watcherId,
        url: cmd.url,
        ...(cmd.channel === undefined ? {} : { channel: cmd.channel }),
        ...(cmd.labelKey === undefined ? {} : { labelKey: cmd.labelKey }),
        ...(cmd.labelValue === undefined ? {} : { labelValue: cmd.labelValue }),
        kinds: [...cmd.kinds],
        ownerId: actorId(got.actor),
      }),
    ];
  });

export const decideRemoveWatcher = (
  state: State,
  cmd: { readonly watcherId: string },
  boardId: string,
) =>
  Effect.gen(function* () {
    const got = yield* gate(state, boardId);

    if (!("open" in got)) return got;

    return [new WatcherRemoved({ watcherId: cmd.watcherId })];
  });

export const decideSchedule = (
  state: State,
  cmd: {
    readonly threadId: string;
    readonly body: string;
    readonly inMs?: number;
    readonly everyMs?: number;
  },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const message = open.threads[cmd.threadId];

    if (message === undefined) return yield* new UnknownMessage();
    const got = yield* gate(state, boardId);

    if (!("open" in got)) return got;

    if (allowed(got.open, got.actor, message.channel, "post") !== undefined) {
      return yield* new Forbidden({ action: "post" });
    }

    const delay = cmd.everyMs ?? cmd.inMs;

    if (delay === undefined || !Number.isInteger(delay) || delay < 250 || delay > 30 * 86_400_000) {
      return yield* new InvalidSchedule();
    }

    if (blank(cmd.body) || cmd.body.length > MESSAGE_MAX) return yield* new InvalidMessage();
    const scheduleId = `s${got.open.nextSeq}`;

    return [
      new FollowUpScheduled({
        scheduleId,
        threadId: message.threadId,
        body: cmd.body,
        ...(cmd.inMs === undefined ? {} : { inMs: cmd.inMs }),
        ...(cmd.everyMs === undefined ? {} : { everyMs: cmd.everyMs }),
        generation: 1,
        ownerId: actorId(got.actor),
        authorName: got.actor.name,
        ...(got.actor.profile === undefined ? {} : { profile: got.actor.profile }),
      }),
    ];
  });

export const decideCancelSchedule = (
  state: State,
  cmd: { readonly scheduleId: string },
  boardId: string,
) =>
  Effect.gen(function* () {
    const got = yield* gate(state, boardId);

    if (!("open" in got)) return got;
    const schedule = got.open.schedules[cmd.scheduleId];

    if (schedule === undefined) return yield* new UnknownMessage();

    if (schedule.ownerId !== actorId(got.actor) && !isTeamOwner(got.actor)) {
      return yield* new Forbidden({ action: "manage" });
    }

    return [new FollowUpCanceled({ scheduleId: cmd.scheduleId })];
  });

export const decideDeliver = (
  state: State,
  cmd: { readonly scheduleId: string; readonly generation: number },
) => {
  const open = asOpen(state);

  if (open._tag !== "Open") return [];
  const schedule = open.schedules[cmd.scheduleId];

  if (schedule === undefined || !schedule.active || schedule.generation !== cmd.generation)
    return [];
  const message = open.threads[schedule.threadId];

  if (message === undefined) return [];
  const seq = open.nextSeq;
  const messageId = messageCursor(seq);
  const posted = new MessagePosted({
    messageId,
    channel: message.channel,
    threadId: message.threadId,
    body: schedule.body,
    authorId: schedule.ownerId,
    authorName: schedule.authorName,
    ...(schedule.profile === undefined ? {} : { profile: schedule.profile }),
    labels: {},
    mentions: mentionsIn(schedule.body),
    createdAt: seq,
    seq,
  });
  const urls = watcherUrls(open, "reply", message.channel, message.labels);
  const next =
    schedule.everyMs === undefined
      ? []
      : [
          new FollowUpScheduled({
            scheduleId: schedule.scheduleId,
            threadId: schedule.threadId,
            body: schedule.body,
            everyMs: schedule.everyMs,
            generation: cmd.generation + 1,
            ownerId: schedule.ownerId,
            authorName: schedule.authorName,
            ...(schedule.profile === undefined ? {} : { profile: schedule.profile }),
          }),
        ];

  return [
    posted,
    new FollowUpDelivered({ scheduleId: schedule.scheduleId, generation: cmd.generation }),
    ...next,
    ...(urls.length === 0
      ? []
      : [new WatchersMatched({ urls, summary: schedule.body.slice(0, 140) })]),
  ];
};
