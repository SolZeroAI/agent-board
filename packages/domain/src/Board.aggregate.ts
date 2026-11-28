import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import type { Actor } from "./Actor.ts";
import { State, type Item, type Open } from "./boardState.ts";
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
import { allowed } from "./scope.ts";
import { openBoard } from "./decideAccess.ts";
import {
  decideCancelSchedule,
  decideChannel,
  decideDeliver,
  decideGrant,
  decideRemoveWatcher,
  decideRevoke,
  decideSchedule,
  decideSchema,
  decideWatcher,
} from "./decideAccess.ts";
import { decideRead } from "./decideReads.ts";
import {
  decideClaimReady,
  decideClaimTask,
  decideComplete,
  decideCreateTask,
  decideFail,
  decideMakeTask,
  decidePlan,
  decideRelease,
  decideRenew,
  decideBlock,
  decideUnblock,
  decideCancel,
  decideReopen,
  decideAssign,
  decideNeeds,
} from "./decideTasks.ts";
import {
  decideDelete,
  decideEdit,
  decideLabels,
  decideAttach,
  decidePost,
  decideReact,
  decideReply,
} from "./decideMessages.ts";
import {
  foldAttachment,
  foldChannelCreated,
  foldFollowCanceled,
  foldFollowDelivered,
  foldFollowScheduled,
  foldGrantCreated,
  foldGrantRevoked,
  foldLabels,
  foldMessageDeleted,
  foldMessageEdited,
  foldMessagePosted,
  foldPlan,
  foldReactionAdded,
  foldReactionRemoved,
  foldSchema,
  foldTaskAssigned,
  foldTaskBlocked,
  foldTaskCanceled,
  foldTaskClaimed,
  foldTaskCompleted,
  foldTaskCreated,
  foldTaskExpired,
  foldTaskFailed,
  foldTaskNeeds,
  foldTaskReady,
  foldTaskReleased,
  foldTaskRenewed,
  foldTaskReopened,
  foldTaskUnblocked,
  foldWatcherRegistered,
  foldWatcherRemoved,
} from "./foldParity.ts";
import { AgentRegistered, OpenBoard } from "./OpenBoard.command.ts";
import { PostWork, WorkPosted } from "./PostWork.command.ts";
import {
  AgentExists,
  BoardClosed,
  Forbidden,
  InvalidLease,
  InvalidMessage,
  InvalidWork,
  NotClaimant,
  NotClaimed,
  NotMember,
  UnknownAgent,
  UnknownItem,
} from "./rejections.ts";
import * as Parity from "./parity.commands.ts";
import {
  explain,
  replyActors,
  replyAttachment,
  replyChannel,
  replyChannels,
  replyFeed,
  replyGrants,
  replySchemas,
  replyTasks,
  replyThread,
} from "./replyParity.ts";
import { AgentRevoked, RegisterAgent, RevokeAgent } from "./RegisterAgent.command.ts";
import { MessageSent, SendMessage } from "./SendMessage.command.ts";
import { PublicWorkItem } from "./WorkItem.ts";

const blank = (value: string) => value.trim().length === 0;

const asAgent = (actor: Actor, boardId: string) =>
  actor._tag === "Agent" && actor.boardId === boardId ? actor : undefined;

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

  if (state.agents[actorId] === undefined || state.agents[actorId]?.revoked === true) {
    return new NotMember();
  }

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
    Parity.CreateChannel,
    Parity.PostMessage,
    Parity.ReplyMessage,
    Parity.EditMessage,
    Parity.DeleteMessage,
    Parity.SetLabels,
    Parity.ReactToMessage,
    Parity.AddAttachment,
    Parity.RegisterSchema,
    Parity.CreateGrant,
    Parity.RevokeGrant,
    Parity.CreateTask,
    Parity.CreatePlan,
    Parity.MakeTask,
    Parity.ClaimTask,
    Parity.ClaimReady,
    Parity.RenewTask,
    Parity.CompleteTask,
    Parity.FailTask,
    Parity.ReleaseTask,
    Parity.BlockTask,
    Parity.UnblockTask,
    Parity.CancelTask,
    Parity.ReopenTask,
    Parity.AssignTask,
    Parity.SetTaskNeeds,
    Parity.ExpireTask,
    Parity.RegisterWatcher,
    Parity.RemoveWatcher,
    Parity.ScheduleFollowUp,
    Parity.CancelFollowUp,
    Parity.DeliverFollowUp,
    Parity.ReadFeed,
    Parity.ReadChannel,
    Parity.ReadThread,
    Parity.ReadTasks,
    Parity.ReadChannels,
    Parity.ReadAttachment,
    Parity.ExplainAccess,
    Parity.ReadActors,
    Parity.ReadSchemas,
    Parity.ReadGrants,
    RevokeAgent,
  ],
  decide: {
    OpenBoard: (state, cmd) => openBoard(state, cmd),
    RegisterAgent: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;

      if (state._tag !== "Open") return yield* new BoardClosed();

      if (actor._tag !== "Human") return yield* new NotMember();

      if (allowed(state, actor, "general", "manage") !== undefined) {
        return yield* new Forbidden({ action: "manage" });
      }

      if (blank(cmd.agentName) || blank(cmd.harness) || blank(cmd.sessionId)) {
        return yield* new InvalidWork();
      }

      if (state.agents[cmd.agentId] !== undefined) return yield* new AgentExists();

      return [
        new AgentRegistered({
          agentId: cmd.agentId,
          name: cmd.agentName.trim(),
          harness: cmd.harness.trim(),
          sessionId: cmd.sessionId,
          ...(cmd.profile === undefined ? {} : { profile: cmd.profile }),
        }),
      ];
    }),
    RevokeAgent: Effect.fn(function* (state, cmd) {
      const actor = yield* CurrentActor;

      if (state._tag !== "Open") return yield* new BoardClosed();

      if (actor._tag !== "Human") return yield* new NotMember();

      if (allowed(state, actor, "general", "manage") !== undefined) {
        return yield* new Forbidden({ action: "manage" });
      }

      const record = state.agents[cmd.agentId];

      if (record === undefined || record.revoked === true) return yield* new UnknownAgent();

      return [new AgentRevoked({ agentId: cmd.agentId, sessionId: record.sessionId ?? "" })];
    }),
    PostWork: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;
      const agent = asAgent(actor, ctx.id);

      if (agent === undefined) return yield* new NotMember();
      const open = opened(state, ctx.id, agent.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;

      if (blank(cmd.title) || blank(cmd.body)) return yield* new InvalidWork();

      return [
        new WorkPosted({
          itemId: cmd.itemId,
          title: cmd.title.trim(),
          body: cmd.body.trim(),
          authorId: agent.agentId,
          seq: open.nextSeq,
        }),
      ];
    }),
    ClaimNext: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;
      const agent = asAgent(actor, ctx.id);

      if (agent === undefined) return yield* new NotMember();
      const open = opened(state, ctx.id, agent.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;
      const lease = leaseError(cmd.leaseMs);

      if (lease !== undefined) return yield* lease;
      const item = nextOpen(open.items);

      if (item === undefined) return [];

      return [
        new WorkClaimed({
          itemId: item.itemId,
          agentId: agent.agentId,
          leaseMs: cmd.leaseMs,
          claimGeneration: item.claimGeneration + 1,
        }),
      ];
    }),
    Heartbeat: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;
      const agent = asAgent(actor, ctx.id);

      if (agent === undefined) return yield* new NotMember();
      const open = opened(state, ctx.id, agent.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;
      const lease = leaseError(cmd.leaseMs);

      if (lease !== undefined) return yield* lease;
      const item = claimedBy(open, cmd.itemId, agent.agentId);

      if (!(item instanceof Object) || !("itemId" in item)) return yield* item;

      return [
        new LeaseExtended({
          itemId: cmd.itemId,
          agentId: agent.agentId,
          leaseMs: cmd.leaseMs,
          claimGeneration: item.claimGeneration + 1,
        }),
      ];
    }),
    CompleteWork: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;
      const agent = asAgent(actor, ctx.id);

      if (agent === undefined) return yield* new NotMember();
      const open = opened(state, ctx.id, agent.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;
      const item = claimedBy(open, cmd.itemId, agent.agentId);

      if (!(item instanceof Object) || !("status" in item)) return yield* item;

      return [
        new WorkCompleted({
          itemId: cmd.itemId,
          agentId: agent.agentId,
          claimGeneration: item.claimGeneration,
        }),
      ];
    }),
    FailWork: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;
      const agent = asAgent(actor, ctx.id);

      if (agent === undefined) return yield* new NotMember();
      const open = opened(state, ctx.id, agent.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;

      if (blank(cmd.reason)) return yield* new InvalidWork();
      const item = claimedBy(open, cmd.itemId, agent.agentId);

      if (!(item instanceof Object) || !("status" in item)) return yield* item;

      return [
        new WorkFailed({
          itemId: cmd.itemId,
          agentId: agent.agentId,
          claimGeneration: item.claimGeneration,
          reason: cmd.reason.trim(),
        }),
      ];
    }),
    ReleaseWork: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;
      const agent = asAgent(actor, ctx.id);

      if (agent === undefined) return yield* new NotMember();
      const open = opened(state, ctx.id, agent.agentId);

      if (open instanceof BoardClosed || open instanceof NotMember) return yield* open;
      const item = claimedBy(open, cmd.itemId, agent.agentId);

      if (!(item instanceof Object) || !("status" in item)) return yield* item;

      return [
        new WorkReleased({
          itemId: cmd.itemId,
          agentId: agent.agentId,
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
      const agent = asAgent(actor, ctx.id);

      if (agent === undefined) return yield* new NotMember();
      const open = opened(state, ctx.id, agent.agentId);

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
          fromAgentId: agent.agentId,
          body: cmd.body.trim(),
          seq: open.nextSeq,
          ...(cmd.toAgentId === undefined ? {} : { toAgentId: cmd.toAgentId }),
          ...(cmd.itemId === undefined ? {} : { itemId: cmd.itemId }),
        }),
      ];
    }),
    CreateChannel: (state, cmd, ctx) => decideChannel(state, cmd, ctx.id),
    PostMessage: (state, cmd, ctx) => decidePost(state, cmd, ctx.id),
    ReplyMessage: (state, cmd, ctx) => decideReply(state, cmd, ctx.id),
    EditMessage: (state, cmd, ctx) => decideEdit(state, cmd, ctx.id),
    DeleteMessage: (state, cmd, ctx) => decideDelete(state, cmd, ctx.id),
    SetLabels: (state, cmd, ctx) => decideLabels(state, cmd, ctx.id),
    ReactToMessage: (state, cmd, ctx) => decideReact(state, cmd, ctx.id),
    AddAttachment: (state, cmd, ctx) => decideAttach(state, cmd, ctx.id),
    RegisterSchema: (state, cmd, ctx) => decideSchema(state, cmd, ctx.id),
    CreateGrant: (state, cmd, ctx) => decideGrant(state, cmd, ctx.id),
    RevokeGrant: (state, cmd, ctx) => decideRevoke(state, cmd, ctx.id),
    CreateTask: (state, cmd, ctx) => decideCreateTask(state, cmd, ctx.id),
    CreatePlan: (state, cmd, ctx) => decidePlan(state, cmd, ctx.id),
    MakeTask: (state, cmd, ctx) => decideMakeTask(state, cmd, ctx.id),
    ClaimTask: (state, cmd, ctx) => decideClaimTask(state, cmd, ctx.id),
    ClaimReady: (state, cmd, ctx) => decideClaimReady(state, cmd, ctx.id),
    RenewTask: (state, cmd, ctx) => decideRenew(state, cmd, ctx.id),
    CompleteTask: (state, cmd, ctx) => decideComplete(state, cmd, ctx.id),
    FailTask: (state, cmd, ctx) => decideFail(state, cmd, ctx.id),
    ReleaseTask: (state, cmd, ctx) => decideRelease(state, cmd, ctx.id),
    BlockTask: (state, cmd, ctx) => decideBlock(state, cmd, ctx.id),
    UnblockTask: (state, cmd, ctx) => decideUnblock(state, cmd, ctx.id),
    CancelTask: (state, cmd, ctx) => decideCancel(state, cmd, ctx.id),
    ReopenTask: (state, cmd, ctx) => decideReopen(state, cmd, ctx.id),
    AssignTask: (state, cmd, ctx) => decideAssign(state, cmd, ctx.id),
    SetTaskNeeds: (state, cmd, ctx) => decideNeeds(state, cmd, ctx.id),
    ExpireTask: (state, cmd) => {
      if (state._tag !== "Open") return [];
      const task = state.tasks[cmd.taskId];

      if (
        task === undefined ||
        task.claimGeneration !== cmd.claimGeneration ||
        task.state !== "claimed"
      ) {
        return [];
      }

      return [new Parity.TaskExpired({ taskId: cmd.taskId, claimGeneration: cmd.claimGeneration })];
    },
    RegisterWatcher: (state, cmd, ctx) => decideWatcher(state, cmd, ctx.id),
    RemoveWatcher: (state, cmd, ctx) => decideRemoveWatcher(state, cmd, ctx.id),
    ScheduleFollowUp: (state, cmd, ctx) => decideSchedule(state, cmd, ctx.id),
    CancelFollowUp: (state, cmd, ctx) => decideCancelSchedule(state, cmd, ctx.id),
    DeliverFollowUp: (state, cmd) => decideDeliver(state, cmd),
    ReadFeed: (state, cmd, ctx) =>
      decideRead(state, ctx.id, "feed", cmd, cmd.includeBookkeeping ?? false),
    ReadChannel: (state, cmd, ctx) => decideRead(state, ctx.id, "channel", cmd),
    ReadThread: (state, cmd, ctx) => decideRead(state, ctx.id, "thread", cmd),
    ReadTasks: (state, cmd, ctx) => decideRead(state, ctx.id, "tasks", cmd),
    ReadChannels: (state, _cmd, ctx) => decideRead(state, ctx.id, "channels"),
    ReadAttachment: (state, cmd, ctx) =>
      decideRead(state, ctx.id, "attachment", { messageId: cmd.attachmentId }),
    ExplainAccess: (state, cmd, ctx) =>
      decideRead(state, ctx.id, "explain", { channel: cmd.channel }),
    ReadActors: (state, _cmd, ctx) => decideRead(state, ctx.id, "actors"),
    ReadSchemas: (state, _cmd, ctx) => decideRead(state, ctx.id, "schemas"),
    ReadGrants: (state, _cmd, ctx) => decideRead(state, ctx.id, "grants"),
  },
  evolve: {
    BoardOpened: (_, event) => ({
      _tag: "Open" as const,
      title: event.title,
      ...(event.ownerAccountId === undefined ? {} : { ownerAccountId: event.ownerAccountId }),
      agents: {},
      humans: {},
      items: {},
      messages: [],
      threads: {},
      tasks: {},
      channels: {},
      grants: [],
      nextGrant: 1,
      schemas: {},
      watchers: [],
      schedules: {},
      plans: {},
      feed: [],
      nextSeq: 1,
    }),
    HumanJoined: (state, event) =>
      state._tag === "Open"
        ? {
            ...state,
            humans: {
              ...state.humans,
              [event.accountId]: {
                accountId: event.accountId,
                name: event.name,
                email: event.email,
              },
            },
          }
        : state,
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
                ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
                ...(event.profile === undefined ? {} : { profile: event.profile }),
                revoked: false,
              },
            },
          }
        : state,
    AgentRevoked: (state, event) =>
      state._tag === "Open" && state.agents[event.agentId] !== undefined
        ? {
            ...state,
            agents: {
              ...state.agents,
              [event.agentId]: { ...state.agents[event.agentId]!, revoked: true },
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
    ChannelCreated: foldChannelCreated,
    MessagePosted: foldMessagePosted,
    MessageEdited: foldMessageEdited,
    MessageDeleted: foldMessageDeleted,
    LabelsChanged: foldLabels,
    ReactionAdded: foldReactionAdded,
    ReactionRemoved: foldReactionRemoved,
    AttachmentAdded: foldAttachment,
    SchemaRegistered: foldSchema,
    GrantCreated: foldGrantCreated,
    GrantRevoked: foldGrantRevoked,
    TaskCreated: foldTaskCreated,
    TaskReady: foldTaskReady,
    TaskClaimed: foldTaskClaimed,
    TaskRenewed: foldTaskRenewed,
    TaskReleased: foldTaskReleased,
    TaskCompleted: foldTaskCompleted,
    TaskFailed: foldTaskFailed,
    TaskBlocked: foldTaskBlocked,
    TaskUnblocked: foldTaskUnblocked,
    TaskCanceled: foldTaskCanceled,
    TaskReopened: foldTaskReopened,
    TaskAssigned: foldTaskAssigned,
    TaskNeedsChanged: foldTaskNeeds,
    TaskExpired: foldTaskExpired,
    WatcherRegistered: foldWatcherRegistered,
    WatcherRemoved: foldWatcherRemoved,
    WatchersMatched: (state) => state,
    FollowUpScheduled: foldFollowScheduled,
    FollowUpCanceled: foldFollowCanceled,
    FollowUpDelivered: foldFollowDelivered,
    PlanNoted: foldPlan,
    ReadMarked: (state) => state,
  },
  reply: {
    OpenBoard: (state) => ({
      title: state._tag === "Open" ? state.title : "",
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
    RevokeAgent: (_state, events) => {
      const revoked = events.find((event) => event._tag === "AgentRevoked");

      return {
        agentId:
          revoked !== undefined && revoked._tag === "AgentRevoked"
            ? revoked.agentId
            : AgentId.make("missing"),
        sessionId:
          revoked !== undefined && revoked._tag === "AgentRevoked" ? revoked.sessionId : "",
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
    CreateChannel: (state) => ({
      path: state._tag === "Open" ? (Object.keys(state.channels).at(-1) ?? "") : "",
    }),
    PostMessage: (_state, events) => postedReply(events),
    ReplyMessage: (_state, events) => postedReply(events),
    EditMessage: (_state, events) => ({ messageId: idOf(events, "MessageEdited") }),
    DeleteMessage: (_state, events) => ({ messageId: idOf(events, "MessageDeleted") }),
    SetLabels: (_state, events) => ({ messageId: idOf(events, "LabelsChanged") }),
    ReactToMessage: (_state, events) => ({
      messageId: idOf(events, "ReactionAdded") || idOf(events, "ReactionRemoved"),
      added: events.some((event) => event._tag === "ReactionAdded"),
    }),
    AddAttachment: (_state, events) => ({
      attachmentId:
        events.find((event) => event._tag === "AttachmentAdded")?.attachment.attachmentId ?? "",
    }),
    RegisterSchema: (_state, events) => ({
      schemaId: events.find((event) => event._tag === "SchemaRegistered")?.schemaId ?? "",
    }),
    CreateGrant: (_state, events) => ({
      grantId: events.find((event) => event._tag === "GrantCreated")?.grantId ?? "",
    }),
    RevokeGrant: (_state, events) => ({
      grantId: events.find((event) => event._tag === "GrantRevoked")?.grantId ?? "",
    }),
    CreateTask: (state, events) => ({
      taskId:
        events.find((event) => event._tag === "TaskCreated")?.taskId ??
        planIds(state, events)[0] ??
        "",
      created: events.some((event) => event._tag === "TaskCreated"),
    }),
    CreatePlan: (state, events) => ({
      taskIds: events.some((event) => event._tag === "TaskCreated")
        ? events.filter((event) => event._tag === "TaskCreated").map((event) => event.taskId)
        : planIds(state, events),
      created: events.some((event) => event._tag === "TaskCreated"),
    }),
    MakeTask: (_state, events) => ({
      taskId: events.find((event) => event._tag === "TaskCreated")?.taskId ?? "",
    }),
    ClaimTask: (state, events) => ({ task: taskReply(state, events) }),
    ClaimReady: (state, events) => ({ task: taskReply(state, events) }),
    RenewTask: (_state, events) => ({
      taskId: events.find((event) => event._tag === "TaskRenewed")?.taskId ?? "",
      claimGeneration: events.find((event) => event._tag === "TaskRenewed")?.claimGeneration ?? 0,
    }),
    CompleteTask: (_state, events) => ({ taskId: idOf(events, "TaskCompleted") }),
    FailTask: (_state, events) => ({ taskId: idOf(events, "TaskFailed") }),
    ReleaseTask: (_state, events) => ({ taskId: idOf(events, "TaskReleased") }),
    BlockTask: (_state, events) => ({ taskId: idOf(events, "TaskBlocked") }),
    UnblockTask: (_state, events) => ({ taskId: idOf(events, "TaskUnblocked") }),
    CancelTask: (_state, events) => ({ taskId: idOf(events, "TaskCanceled") }),
    ReopenTask: (_state, events) => ({ taskId: idOf(events, "TaskReopened") }),
    AssignTask: (_state, events) => ({ taskId: idOf(events, "TaskAssigned") }),
    SetTaskNeeds: (_state, events) => ({ taskId: idOf(events, "TaskNeedsChanged") }),
    RegisterWatcher: (_state, events) => ({
      watcherId: events.find((event) => event._tag === "WatcherRegistered")?.watcherId ?? "",
    }),
    RemoveWatcher: (_state, events) => ({
      watcherId: events.find((event) => event._tag === "WatcherRemoved")?.watcherId ?? "",
    }),
    ScheduleFollowUp: (_state, events) => ({
      scheduleId: events.find((event) => event._tag === "FollowUpScheduled")?.scheduleId ?? "",
    }),
    CancelFollowUp: (_state, events) => ({
      scheduleId: events.find((event) => event._tag === "FollowUpCanceled")?.scheduleId ?? "",
    }),
    ReadFeed: replyFeed,
    ReadChannel: replyChannel,
    ReadThread: replyThread,
    ReadTasks: replyTasks,
    ReadChannels: replyChannels,
    ReadAttachment: replyAttachment,
    ExplainAccess: explain,
    ReadActors: (state) => replyActors(state),
    ReadSchemas: (state) => replySchemas(state),
    ReadGrants: (state) => replyGrants(state),
  },
}) {}

const postedReply = (
  events: ReadonlyArray<{
    readonly _tag: string;
    readonly messageId?: string;
    readonly seq?: number;
  }>,
) => {
  const posted = events.find((event) => event._tag === "MessagePosted");

  return {
    messageId: posted?.messageId ?? "",
    seq: posted?.seq ?? 0,
    cursor: posted?.messageId ?? "",
  };
};

const idOf = (
  events: ReadonlyArray<{
    readonly _tag: string;
    readonly messageId?: string;
    readonly taskId?: string;
  }>,
  tag: string,
) => {
  const found = events.find((event) => event._tag === tag);

  return found?.taskId ?? found?.messageId ?? "";
};

const planIds = (
  state: State,
  events: ReadonlyArray<{
    readonly _tag: string;
    readonly idempotencyKey?: string;
    readonly taskIds?: ReadonlyArray<string>;
  }>,
) => {
  const noted = events.find((event) => event._tag === "PlanNoted");

  if (noted?.taskIds !== undefined) return [...noted.taskIds];

  if (state._tag !== "Open" || noted?.idempotencyKey === undefined) return [];

  return [...(state.plans[noted.idempotencyKey]?.taskIds ?? [])];
};

const taskReply = (
  state: State,
  events: ReadonlyArray<{ readonly _tag: string; readonly taskId?: string }>,
) => {
  const claimed = events.find((event) => event._tag === "TaskClaimed");

  if (claimed?.taskId === undefined || state._tag !== "Open") return null;

  return state.tasks[claimed.taskId] ?? null;
};

const WorkItemIdFallback = () => WorkItemId.make("missing");

const MessageIdFallback = () => MessageId.make("missing");
