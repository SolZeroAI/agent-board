import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { CurrentActor } from "./CurrentActor.ts";
import { WorkClaimed, ClaimNext } from "./ClaimNext.command.ts";
import {
  CompleteWork,
  FailWork,
  ReleaseWork,
  WorkCompleted,
  WorkFailed,
  WorkReleased,
} from "./CompleteWork.command.ts";
import { ExpireLease, LeaseExpired } from "./ExpireLease.command.ts";
import { Heartbeat, LeaseExtended } from "./Heartbeat.command.ts";
import { AgentId, BoardId, LEASE_MAX_MS, LEASE_MIN_MS, MessageId, WorkItemId } from "./ids.ts";
import { AgentRegistered, BoardOpened, OpenBoard } from "./OpenBoard.command.ts";
import { PostWork, WorkPosted } from "./PostWork.command.ts";
import {
  AgentExists,
  AlreadyOpen,
  BoardClosed,
  InvalidLease,
  InvalidMessage,
  InvalidWork,
  NotClaimant,
  NotClaimed,
  NotMember,
  UnknownAgent,
  UnknownItem,
} from "./rejections.ts";
import { RegisterAgent } from "./RegisterAgent.command.ts";
import { MessageSent, SendMessage } from "./SendMessage.command.ts";
import { PublicWorkItem } from "./WorkItem.ts";

const AgentRecord = Schema.Struct({
  agentId: AgentId,
  name: Schema.String,
  harness: Schema.String,
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

type Item = typeof Item.Type;

const StoredMessage = Schema.Struct({
  messageId: Schema.String,
  fromAgentId: AgentId,
  body: Schema.String,
  seq: Schema.Number,
  toAgentId: Schema.optional(AgentId),
  itemId: Schema.optional(Schema.String),
});

type StoredMessage = typeof StoredMessage.Type;

const State = Schema.Union([
  Schema.TaggedStruct("Unopened", {}),
  Schema.TaggedStruct("Open", {
    title: Schema.String,
    agents: Schema.Record(Schema.String, AgentRecord),
    items: Schema.Record(Schema.String, Item),
    messages: Schema.Array(StoredMessage),
    nextSeq: Schema.Number,
  }),
]);

type State = typeof State.Type;

type Open = Extract<State, { _tag: "Open" }>;

const blank = (value: string) => value.trim().length === 0;

const leaseError = (leaseMs: number) =>
  Number.isInteger(leaseMs) && leaseMs >= LEASE_MIN_MS && leaseMs <= LEASE_MAX_MS
    ? undefined
    : new InvalidLease({ leaseMs });

const published = (item: Item): PublicWorkItem => ({
  itemId: item.itemId,
  title: item.title,
  body: item.body,
  authorId: item.authorId,
  status: item.status,
  seq: item.seq,
  claimGeneration: item.claimGeneration,
  ...(item.claimantId === undefined ? {} : { claimantId: item.claimantId }),
  ...(item.leaseMs === undefined ? {} : { leaseMs: item.leaseMs }),
  ...(item.failureReason === undefined ? {} : { failureReason: item.failureReason }),
});

const nextOpen = (items: Open["items"]) =>
  Object.values(items).reduce<Item | undefined>((best, item) => {
    if (item.status !== "open") return best;

    if (best === undefined || item.seq < best.seq) return item;

    return best;
  }, undefined);

const withItem = (state: Open, item: Item): Open => ({
  ...state,
  items: { ...state.items, [item.itemId]: item },
});

const opened = (
  state: State,
  boardId: BoardId,
  actorId: AgentId,
): Open | BoardClosed | NotMember => {
  if (state._tag !== "Open") return new BoardClosed();

  if (state.agents[actorId] === undefined) return new NotMember();

  return state;
};

const claimedBy = (
  state: Open,
  itemId: string,
  actorId: AgentId,
): Item | UnknownItem | NotClaimed | NotClaimant => {
  const item = state.items[itemId];

  if (item === undefined) return new UnknownItem();

  if (item.status !== "claimed" || item.claimantId === undefined) return new NotClaimed();

  if (item.claimantId !== actorId) return new NotClaimant();

  return item;
};

const releaseFields = (item: Item): Item => ({
  itemId: item.itemId,
  title: item.title,
  body: item.body,
  authorId: item.authorId,
  status: "open",
  seq: item.seq,
  claimGeneration: item.claimGeneration,
});

/**
 * One board. Every claim, heartbeat, and release for that board is decided
 * here, one command at a time.
 */
export class Board extends Domain.Aggregate("Board", {
  id: BoardId,
  state: State,
  initial: { _tag: "Unopened" },
  commands: [
    OpenBoard,
    RegisterAgent,
    PostWork,
    ClaimNext,
    Heartbeat,
    CompleteWork,
    FailWork,
    ReleaseWork,
    ExpireLease,
    SendMessage,
  ],
  decide: {
    OpenBoard: (state, cmd) => {
      if (state._tag !== "Unopened") return new AlreadyOpen();

      if (blank(cmd.title) || blank(cmd.agentName) || blank(cmd.harness)) return new InvalidWork();

      return [
        new BoardOpened({ title: cmd.title.trim() }),
        new AgentRegistered({
          agentId: cmd.agentId,
          name: cmd.agentName.trim(),
          harness: cmd.harness.trim(),
        }),
      ];
    },
    RegisterAgent: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;

      if (actor.boardId !== ctx.id) return yield* new NotMember();
      const open = opened(state, ctx.id, actor.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;

      if (blank(cmd.agentName) || blank(cmd.harness)) return yield* new InvalidWork();

      if (open.agents[cmd.agentId] !== undefined) return yield* new AgentExists();

      return [
        new AgentRegistered({
          agentId: cmd.agentId,
          name: cmd.agentName.trim(),
          harness: cmd.harness.trim(),
        }),
      ];
    }),
    PostWork: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;

      if (actor.boardId !== ctx.id) return yield* new NotMember();
      const open = opened(state, ctx.id, actor.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;

      if (blank(cmd.title) || blank(cmd.body)) return yield* new InvalidWork();

      return [
        new WorkPosted({
          itemId: cmd.itemId,
          title: cmd.title.trim(),
          body: cmd.body.trim(),
          authorId: actor.agentId,
          seq: open.nextSeq,
        }),
      ];
    }),
    ClaimNext: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;

      if (actor.boardId !== ctx.id) return yield* new NotMember();
      const open = opened(state, ctx.id, actor.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;
      const lease = leaseError(cmd.leaseMs);

      if (lease !== undefined) return yield* lease;
      const item = nextOpen(open.items);

      if (item === undefined) return [];

      return [
        new WorkClaimed({
          itemId: item.itemId,
          agentId: actor.agentId,
          leaseMs: cmd.leaseMs,
          claimGeneration: item.claimGeneration + 1,
        }),
      ];
    }),
    Heartbeat: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;

      if (actor.boardId !== ctx.id) return yield* new NotMember();
      const open = opened(state, ctx.id, actor.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;
      const lease = leaseError(cmd.leaseMs);

      if (lease !== undefined) return yield* lease;
      const item = claimedBy(open, cmd.itemId, actor.agentId);

      if (!(item instanceof Object) || !("itemId" in item)) return yield* item;

      return [
        new LeaseExtended({
          itemId: cmd.itemId,
          agentId: actor.agentId,
          leaseMs: cmd.leaseMs,
          claimGeneration: item.claimGeneration + 1,
        }),
      ];
    }),
    CompleteWork: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;

      if (actor.boardId !== ctx.id) return yield* new NotMember();
      const open = opened(state, ctx.id, actor.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;
      const item = claimedBy(open, cmd.itemId, actor.agentId);

      if (!(item instanceof Object) || !("status" in item)) return yield* item;

      return [
        new WorkCompleted({
          itemId: cmd.itemId,
          agentId: actor.agentId,
          claimGeneration: item.claimGeneration,
        }),
      ];
    }),
    FailWork: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;

      if (actor.boardId !== ctx.id) return yield* new NotMember();
      const open = opened(state, ctx.id, actor.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;

      if (blank(cmd.reason)) return yield* new InvalidWork();
      const item = claimedBy(open, cmd.itemId, actor.agentId);

      if (!(item instanceof Object) || !("status" in item)) return yield* item;

      return [
        new WorkFailed({
          itemId: cmd.itemId,
          agentId: actor.agentId,
          claimGeneration: item.claimGeneration,
          reason: cmd.reason.trim(),
        }),
      ];
    }),
    ReleaseWork: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;

      if (actor.boardId !== ctx.id) return yield* new NotMember();
      const open = opened(state, ctx.id, actor.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;
      const item = claimedBy(open, cmd.itemId, actor.agentId);

      if (!(item instanceof Object) || !("status" in item)) return yield* item;

      return [
        new WorkReleased({
          itemId: cmd.itemId,
          agentId: actor.agentId,
          claimGeneration: item.claimGeneration,
        }),
      ];
    }),
    ExpireLease: (state, cmd) => {
      if (state._tag !== "Open") return [];
      const item = state.items[cmd.itemId];

      if (item === undefined || item.status !== "claimed") return [];

      if (item.claimGeneration !== cmd.claimGeneration) return [];

      return [new LeaseExpired({ itemId: cmd.itemId, claimGeneration: cmd.claimGeneration })];
    },
    SendMessage: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;

      if (actor.boardId !== ctx.id) return yield* new NotMember();
      const open = opened(state, ctx.id, actor.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;

      if (blank(cmd.body) || (cmd.toAgentId === undefined && cmd.itemId === undefined)) {
        return yield* new InvalidMessage();
      }

      if (cmd.toAgentId !== undefined && open.agents[cmd.toAgentId] === undefined) {
        return yield* new UnknownAgent();
      }

      if (cmd.itemId !== undefined && open.items[cmd.itemId] === undefined) {
        return yield* new UnknownItem();
      }

      return [
        new MessageSent({
          messageId: cmd.messageId,
          fromAgentId: actor.agentId,
          body: cmd.body.trim(),
          seq: open.nextSeq,
          ...(cmd.toAgentId === undefined ? {} : { toAgentId: cmd.toAgentId }),
          ...(cmd.itemId === undefined ? {} : { itemId: cmd.itemId }),
        }),
      ];
    }),
  },
  evolve: {
    BoardOpened: (_, event) => ({
      _tag: "Open" as const,
      title: event.title,
      agents: {},
      items: {},
      messages: [],
      nextSeq: 1,
    }),
    AgentRegistered: (state, event) =>
      state._tag === "Open"
        ? {
            ...state,
            agents: {
              ...state.agents,
              [event.agentId]: {
                agentId: event.agentId,
                name: event.name,
                harness: event.harness,
              },
            },
          }
        : state,
    WorkPosted: (state, event) =>
      state._tag === "Open"
        ? {
            ...withItem(state, {
              itemId: event.itemId,
              title: event.title,
              body: event.body,
              authorId: event.authorId,
              status: "open",
              seq: event.seq,
              claimGeneration: 0,
            }),
            nextSeq: state.nextSeq + 1,
          }
        : state,
    WorkClaimed: (state, event) => {
      if (state._tag !== "Open") return state;
      const item = state.items[event.itemId];

      if (item === undefined) return state;

      return withItem(state, {
        ...item,
        status: "claimed",
        claimantId: event.agentId,
        leaseMs: event.leaseMs,
        claimGeneration: event.claimGeneration,
      });
    },
    LeaseExtended: (state, event) => {
      if (state._tag !== "Open") return state;
      const item = state.items[event.itemId];

      if (item === undefined) return state;

      return withItem(state, {
        ...item,
        status: "claimed",
        claimantId: event.agentId,
        leaseMs: event.leaseMs,
        claimGeneration: event.claimGeneration,
      });
    },
    WorkCompleted: (state, event) => {
      if (state._tag !== "Open") return state;
      const item = state.items[event.itemId];

      if (item === undefined) return state;

      return withItem(state, { ...releaseFields(item), status: "done" });
    },
    WorkFailed: (state, event) => {
      if (state._tag !== "Open") return state;
      const item = state.items[event.itemId];

      if (item === undefined) return state;

      return withItem(state, {
        ...releaseFields(item),
        status: "failed",
        failureReason: event.reason,
        claimantId: event.agentId,
      });
    },
    WorkReleased: (state, event) => {
      if (state._tag !== "Open") return state;
      const item = state.items[event.itemId];

      if (item === undefined) return state;

      return withItem(state, releaseFields(item));
    },
    LeaseExpired: (state, event) => {
      if (state._tag !== "Open") return state;
      const item = state.items[event.itemId];

      if (item === undefined || item.claimGeneration !== event.claimGeneration) return state;

      return withItem(state, releaseFields(item));
    },
    MessageSent: (state, event) =>
      state._tag === "Open"
        ? {
            ...state,
            messages: [
              ...state.messages,
              {
                messageId: event.messageId,
                fromAgentId: event.fromAgentId,
                body: event.body,
                seq: event.seq,
                ...(event.toAgentId === undefined ? {} : { toAgentId: event.toAgentId }),
                ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
              },
            ],
            nextSeq: state.nextSeq + 1,
          }
        : state,
  },
  reply: {
    OpenBoard: (state) => ({
      agentId: state._tag === "Open" ? firstAgent(state) : AgentId.make("missing"),
    }),
    RegisterAgent: (_state, events) => {
      const registered = events.find((event) => event._tag === "AgentRegistered");

      return {
        agentId:
          registered !== undefined && registered._tag === "AgentRegistered"
            ? registered.agentId
            : AgentId.make("missing"),
      };
    },
    PostWork: (_state, events) => {
      const posted = events.find((event) => event._tag === "WorkPosted");

      if (posted === undefined || posted._tag !== "WorkPosted") {
        return { itemId: WorkItemIdFallback(), seq: 0 };
      }

      return { itemId: posted.itemId, seq: posted.seq };
    },
    ClaimNext: (state, events) => {
      const claimed = events.find((event) => event._tag === "WorkClaimed");

      if (claimed === undefined || claimed._tag !== "WorkClaimed" || state._tag !== "Open") {
        return { item: null };
      }

      const item = state.items[claimed.itemId];

      return { item: item === undefined ? null : published(item) };
    },
    SendMessage: (_state, events) => {
      const sent = events.find((event) => event._tag === "MessageSent");

      if (sent === undefined || sent._tag !== "MessageSent") {
        return { messageId: MessageIdFallback(), seq: 0 };
      }

      return { messageId: sent.messageId, seq: sent.seq };
    },
  },
}) {}

const firstAgent = (state: Open) => {
  const agent = Object.values(state.agents)[0];

  return agent === undefined ? AgentId.make("missing") : agent.agentId;
};

const WorkItemIdFallback = () => WorkItemId.make("missing");

const MessageIdFallback = () => MessageId.make("missing");
