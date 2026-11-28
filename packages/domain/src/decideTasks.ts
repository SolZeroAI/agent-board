import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { actorId, type Actor } from "./Actor.ts";
import type { Message, Open, State, Task } from "./boardState.ts";
import { CurrentActor } from "./CurrentActor.ts";
import { TASK_LEASE_MAX_MS, LEASE_MIN_MS } from "./ids.ts";
import {
  ChannelCreated,
  LabelsChanged,
  MessagePosted,
  PlanNoted,
  TaskAssigned,
  TaskBlocked,
  TaskCanceled,
  TaskClaimed,
  TaskCompleted,
  TaskCreated,
  TaskFailed,
  TaskNeedsChanged,
  TaskReady,
  TaskReleased,
  TaskRenewed,
  TaskReopened,
  TaskUnblocked,
  WatchersMatched,
} from "./parity.commands.ts";
import {
  ChannelTreeTooLarge,
  ClaimLost,
  IdempotencyConflict,
  InvalidChannel,
  InvalidLabel,
  InvalidLease,
  InvalidPlan,
  InvalidWork,
  NothingReady,
  TaskNotOwned,
  TaskState,
  UnknownMessage,
  UnknownTask,
} from "./rejections.ts";
import { allowed, asOpen, authored, onBoard, ownsTask, taskLabel, watcherUrls } from "./scope.ts";
import {
  blank,
  labelError,
  mentionsIn,
  messageCursor,
  subtree,
  validChannel,
  validProfile,
} from "./text.ts";

const ready = (
  state: State,
  boardId: string,
  channel: string,
  permission: "post" | "label" | "manage",
) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const grant = allowed(open, actor, channel, permission);

    if (grant !== undefined) return yield* grant;

    return { open, actor, createdAt: yield* Clock.currentTimeMillis };
  });

const leaseOk = (leaseMs: number) =>
  Number.isInteger(leaseMs) && leaseMs >= LEASE_MIN_MS && leaseMs <= TASK_LEASE_MAX_MS
    ? undefined
    : new InvalidLease({ leaseMs });

const wake = (open: Open, channel: string, labels: Message["labels"], summary: string) => {
  const urls = watcherUrls(open, "task", channel, labels);

  return urls.length === 0 ? [] : [new WatchersMatched({ urls, summary })];
};

const labelEvent = (
  message: Message | undefined,
  taskId: string,
  stateName: string,
  actor: Actor,
  createdAt: number,
) =>
  new LabelsChanged({
    messageId: taskId,
    labels: taskLabel(message?.labels ?? {}, stateName),
    ...authored(actor, createdAt),
  });

const initialState = (open: Open, needs: ReadonlyArray<string>) =>
  needs.every((id) => open.tasks[id]?.state === "completed") ? "ready" : "waiting";

const dependents = (open: Open, doneId: string) =>
  Object.values(open.tasks).filter(
    (task) =>
      task.state === "waiting" &&
      task.needs.includes(doneId) &&
      task.needs.every((id) => id === doneId || open.tasks[id]?.state === "completed"),
  );

export const decideCreateTask = (
  state: State,
  cmd: {
    readonly channel: string;
    readonly text: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly needs?: ReadonlyArray<string>;
    readonly for?: string;
    readonly idempotencyKey?: string;
  },
  boardId: string,
) =>
  Effect.gen(function* () {
    if (!validChannel(cmd.channel)) return yield* new InvalidChannel();
    const got = yield* ready(state, boardId, cmd.channel, "post");

    if (!("open" in got)) return got;

    if (cmd.idempotencyKey !== undefined) {
      const existing = got.open.plans[cmd.idempotencyKey];
      const fingerprint = JSON.stringify({
        text: cmd.text,
        labels: cmd.labels ?? {},
        needs: cmd.needs ?? [],
        for: cmd.for ?? null,
      });

      if (existing !== undefined && existing.fingerprint !== fingerprint) {
        return yield* new IdempotencyConflict();
      }

      if (existing !== undefined) {
        return [
          new PlanNoted({
            idempotencyKey: cmd.idempotencyKey,
            fingerprint,
            taskIds: [...existing.taskIds],
          }),
        ];
      }
    }

    return yield* createOne(got.open, got.actor, got.createdAt, cmd);
  });

const createOne = (
  open: Open,
  actor: Actor,
  createdAt: number,
  cmd: {
    readonly channel: string;
    readonly text: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly needs?: ReadonlyArray<string>;
    readonly for?: string;
    readonly idempotencyKey?: string;
  },
) =>
  Effect.gen(function* () {
    if (blank(cmd.text)) return yield* new InvalidWork();

    for (const [key, value] of Object.entries(cmd.labels ?? {})) {
      if (labelError(key, value) !== undefined) return yield* new InvalidLabel({ key });
    }

    if (cmd.for !== undefined && !validProfile(cmd.for))
      return yield* new InvalidPlan({ reason: "for" });

    for (const need of cmd.needs ?? []) {
      if (open.tasks[need] === undefined) return yield* new InvalidPlan({ reason: need });
    }

    const seq = open.nextSeq;
    const taskId = messageCursor(seq);
    const needs = [...(cmd.needs ?? [])];
    const stateName = initialState(open, needs);
    const labels = taskLabel(cmd.labels ?? {}, stateName);
    const channel =
      open.channels[cmd.channel] === undefined
        ? [new ChannelCreated({ path: cmd.channel, isPrivate: false, seq })]
        : [];
    const posted = new MessagePosted({
      messageId: taskId,
      channel: cmd.channel,
      threadId: taskId,
      body: cmd.text,
      authorId: actorId(actor),
      authorName: actor.name,
      ...(actor.profile === undefined ? {} : { profile: actor.profile }),
      labels,
      mentions: mentionsIn(cmd.text),
      createdAt,
      seq,
    });
    const created = new TaskCreated({
      taskId,
      channel: cmd.channel,
      state: stateName,
      ownerId: actorId(actor),
      ...(actor.profile === undefined ? {} : { ownerProfile: actor.profile }),
      ...(cmd.for === undefined ? {} : { assignee: cmd.for }),
      needs,
      seq,
      text: cmd.text,
      ...authored(actor, createdAt),
    });
    const plan =
      cmd.idempotencyKey === undefined
        ? []
        : [
            new PlanNoted({
              idempotencyKey: cmd.idempotencyKey,
              fingerprint: JSON.stringify({
                text: cmd.text,
                labels: cmd.labels ?? {},
                needs,
                for: cmd.for ?? null,
              }),
              taskIds: [taskId],
            }),
          ];

    return [...channel, posted, created, ...plan, ...wake(open, cmd.channel, labels, cmd.text)];
  });

const PLAN_KEYS = new Set(["key", "text", "labels", "needs", "for"]);

export const decidePlan = (
  state: State,
  cmd: {
    readonly channel: string;
    readonly idempotencyKey: string;
    readonly tasks: ReadonlyArray<{
      readonly key?: string;
      readonly text: string;
      readonly labels?: Readonly<Record<string, string>>;
      readonly needs?: ReadonlyArray<string>;
      readonly for?: string;
    }>;
  },
  boardId: string,
) =>
  Effect.gen(function* () {
    if (!validChannel(cmd.channel)) return yield* new InvalidChannel();
    const got = yield* ready(state, boardId, cmd.channel, "post");

    if (!("open" in got)) return got;
    const fingerprint = JSON.stringify(cmd.tasks);
    const existing = got.open.plans[cmd.idempotencyKey];

    if (existing !== undefined && existing.fingerprint !== fingerprint) {
      return yield* new IdempotencyConflict();
    }

    if (existing !== undefined) {
      return [
        new PlanNoted({
          idempotencyKey: cmd.idempotencyKey,
          fingerprint,
          taskIds: [...existing.taskIds],
        }),
      ];
    }

    const keys = new Map<string, string>();

    for (const task of cmd.tasks) {
      const extra = Object.keys(task).find((key) => !PLAN_KEYS.has(key));

      if (extra !== undefined) return yield* new InvalidPlan({ reason: extra });

      if (blank(task.text)) return yield* new InvalidPlan({ reason: "text" });

      if (task.for !== undefined && !validProfile(task.for))
        return yield* new InvalidPlan({ reason: "for" });
    }

    let seq = got.open.nextSeq;
    const events = [];
    const ids: string[] = [];

    if (got.open.channels[cmd.channel] === undefined) {
      events.push(new ChannelCreated({ path: cmd.channel, isPrivate: false, seq }));
    }

    for (const task of cmd.tasks) {
      const taskId = messageCursor(seq);
      if (task.key !== undefined) keys.set(task.key, taskId);
      ids.push(taskId);
      const needs = (task.needs ?? []).map((need) => keys.get(need) ?? need);

      for (const need of needs) {
        if (
          keys.get(need) === undefined &&
          got.open.tasks[need] === undefined &&
          !ids.includes(need)
        ) {
          return yield* new InvalidPlan({ reason: need });
        }
      }

      const labels = taskLabel(task.labels ?? {}, needs.length === 0 ? "ready" : "waiting");
      events.push(
        new MessagePosted({
          messageId: taskId,
          channel: cmd.channel,
          threadId: taskId,
          body: task.text,
          authorId: actorId(got.actor),
          authorName: got.actor.name,
          ...(got.actor.profile === undefined ? {} : { profile: got.actor.profile }),
          labels,
          mentions: mentionsIn(task.text),
          createdAt: got.createdAt,
          seq,
        }),
        new TaskCreated({
          taskId,
          channel: cmd.channel,
          state: needs.length === 0 ? "ready" : "waiting",
          ownerId: actorId(got.actor),
          ...(got.actor.profile === undefined ? {} : { ownerProfile: got.actor.profile }),
          ...(task.for === undefined ? {} : { assignee: task.for }),
          needs,
          seq,
          text: task.text,
          ...authored(got.actor, got.createdAt),
        }),
      );
      seq += 1;
    }

    events.push(new PlanNoted({ idempotencyKey: cmd.idempotencyKey, fingerprint, taskIds: ids }));

    return events;
  });

const held = (open: Open, taskId: string, actor: Actor) => {
  const task = open.tasks[taskId];

  if (task === undefined) return new UnknownTask();

  if (task.state !== "claimed" || task.claimantId !== actorId(actor)) return new ClaimLost();

  if (actor.profile !== undefined && task.claimantProfile !== actor.profile) return new ClaimLost();

  return task;
};

const claimEvents = (open: Open, task: Task, actor: Actor, leaseMs: number, createdAt: number) => {
  const message = open.threads[task.taskId];
  const claimed = new TaskClaimed({
    taskId: task.taskId,
    claimantId: actorId(actor),
    ...(actor.profile === undefined ? {} : { claimantProfile: actor.profile }),
    leaseMs,
    claimGeneration: task.claimGeneration + 1,
    createdAt,
  });
  const labels = labelEvent(message, task.taskId, "claimed", actor, createdAt);

  return [claimed, labels, ...wake(open, task.channel, labels.labels, "claimed")];
};

export const decideClaimTask = (
  state: State,
  cmd: { readonly taskId: string; readonly leaseMs: number },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const task = open.tasks[cmd.taskId];

    if (task === undefined) return yield* new UnknownTask();
    const got = yield* ready(state, boardId, task.channel, "label");

    if (!("open" in got)) return got;
    const lease = leaseOk(cmd.leaseMs);

    if (lease !== undefined) return yield* lease;

    if (task.state !== "ready") return yield* new TaskState({ state: task.state });

    if (task.assignee !== undefined && task.assignee !== got.actor.profile) {
      return yield* new TaskNotOwned();
    }

    return claimEvents(got.open, task, got.actor, cmd.leaseMs, got.createdAt);
  });

export const decideClaimReady = (
  state: State,
  cmd: {
    readonly channel: string;
    readonly leaseMs: number;
    readonly labelKey?: string;
    readonly labelValue?: string;
    readonly from?: ReadonlyArray<string>;
  },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const lease = leaseOk(cmd.leaseMs);

    if (lease !== undefined) return yield* lease;
    const paths = Object.keys(open.channels).filter((path) => subtree(cmd.channel, path));

    if (paths.length > 50) return yield* new ChannelTreeTooLarge();
    const owners = new Set([actorId(actor), ...(cmd.from ?? [])]);
    const candidates = Object.values(open.tasks)
      .filter((task) => task.state === "ready" && subtree(cmd.channel, task.channel))
      .filter((task) => owners.has(task.ownerId))
      .filter((task) => task.assignee === undefined || task.assignee === actor.profile)
      .filter((task) => {
        if (cmd.labelKey === undefined) return true;
        const message = open.threads[task.taskId];

        return message?.labels[cmd.labelKey] === cmd.labelValue;
      })
      .filter((task) => allowed(open, actor, task.channel, "label") === undefined)
      .sort((left, right) => {
        const leftAssigned = left.assignee !== undefined ? 0 : 1;
        const rightAssigned = right.assignee !== undefined ? 0 : 1;

        if (leftAssigned !== rightAssigned) return leftAssigned - rightAssigned;

        return left.seq - right.seq;
      });
    const task = candidates[0];

    if (task === undefined) return [];
    const createdAt = yield* Clock.currentTimeMillis;

    return claimEvents(open, task, actor, cmd.leaseMs, createdAt);
  });

export const decideRenew = (
  state: State,
  cmd: { readonly taskId: string; readonly leaseMs: number },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const lease = leaseOk(cmd.leaseMs);

    if (lease !== undefined) return yield* lease;
    const task = held(open, cmd.taskId, actor);

    if (!(task instanceof Object) || !("taskId" in task)) return yield* task;

    return [
      new TaskRenewed({
        taskId: cmd.taskId,
        leaseMs: cmd.leaseMs,
        claimGeneration: task.claimGeneration + 1,
        createdAt: yield* Clock.currentTimeMillis,
      }),
    ];
  });

const settle = (
  open: Open,
  actor: Actor,
  taskId: string,
  event: TaskCompleted | TaskFailed | TaskReleased,
  stateName: string,
) => {
  const message = open.threads[taskId];
  const labels = labelEvent(
    message,
    taskId,
    stateName,
    actor,
    "createdAt" in event ? event.createdAt : 0,
  );
  const extra =
    event._tag === "TaskCompleted"
      ? dependents(open, taskId).flatMap((task) => [
          new TaskReady({ taskId: task.taskId }),
          labelEvent(open.threads[task.taskId], task.taskId, "ready", actor, labels.createdAt),
        ])
      : [];

  return [event, labels, ...extra, ...wake(open, message?.channel ?? "", labels.labels, stateName)];
};

export const decideComplete = (
  state: State,
  cmd: { readonly taskId: string; readonly result: string },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const task = held(open, cmd.taskId, actor);

    if (!(task instanceof Object) || !("taskId" in task)) return yield* task;

    return settle(
      open,
      actor,
      cmd.taskId,
      new TaskCompleted({
        taskId: cmd.taskId,
        result: cmd.result,
        createdAt: yield* Clock.currentTimeMillis,
      }),
      "completed",
    );
  });

export const decideFail = (
  state: State,
  cmd: { readonly taskId: string; readonly reason: string },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;

    if (blank(cmd.reason)) return yield* new InvalidWork();
    const task = held(open, cmd.taskId, actor);

    if (!(task instanceof Object) || !("taskId" in task)) return yield* task;

    return settle(
      open,
      actor,
      cmd.taskId,
      new TaskFailed({
        taskId: cmd.taskId,
        reason: cmd.reason.trim(),
        createdAt: yield* Clock.currentTimeMillis,
      }),
      "failed",
    );
  });

export const decideRelease = (state: State, cmd: { readonly taskId: string }, boardId: string) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const task = held(open, cmd.taskId, actor);

    if (!(task instanceof Object) || !("taskId" in task)) return yield* task;

    return settle(
      open,
      actor,
      cmd.taskId,
      new TaskReleased({ taskId: cmd.taskId, createdAt: yield* Clock.currentTimeMillis }),
      "ready",
    );
  });

const ownerOrManage = (open: Open, task: Task, actor: Actor) =>
  ownsTask(task, actor) || allowed(open, actor, task.channel, "manage") === undefined;

export const decideBlock = (
  state: State,
  cmd: { readonly taskId: string; readonly prompt: string; readonly kind: string },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const task = open.tasks[cmd.taskId];

    if (task === undefined) return yield* new UnknownTask();
    const claimant = task.state === "claimed" && held(open, cmd.taskId, actor);

    if (!claimant && !ownerOrManage(open, task, actor)) return yield* new TaskNotOwned();

    if (task.state === "completed" || task.state === "canceled") {
      return yield* new TaskState({ state: task.state });
    }

    if (blank(cmd.prompt) || blank(cmd.kind)) return yield* new InvalidWork();
    const createdAt = yield* Clock.currentTimeMillis;
    const blocked = new TaskBlocked({
      taskId: cmd.taskId,
      kind: cmd.kind.trim(),
      prompt: cmd.prompt.trim(),
      createdAt,
    });
    const labels = labelEvent(open.threads[cmd.taskId], cmd.taskId, "blocked", actor, createdAt);

    return [blocked, labels, ...wake(open, task.channel, labels.labels, cmd.prompt)];
  });

export const decideUnblock = (state: State, cmd: { readonly taskId: string }, boardId: string) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const task = open.tasks[cmd.taskId];

    if (task === undefined) return yield* new UnknownTask();

    if (!ownerOrManage(open, task, actor)) return yield* new TaskNotOwned();

    if (task.state !== "blocked") return yield* new TaskState({ state: task.state });
    const stateName = initialState(open, task.needs);
    const createdAt = yield* Clock.currentTimeMillis;
    const event = new TaskUnblocked({ taskId: cmd.taskId, state: stateName, createdAt });
    const labels = labelEvent(open.threads[cmd.taskId], cmd.taskId, stateName, actor, createdAt);

    return [event, labels];
  });

export const decideCancel = (
  state: State,
  cmd: { readonly taskId: string; readonly reason: string },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const task = open.tasks[cmd.taskId];

    if (task === undefined) return yield* new UnknownTask();

    if (!ownerOrManage(open, task, actor)) return yield* new TaskNotOwned();

    if (blank(cmd.reason)) return yield* new InvalidWork();
    const createdAt = yield* Clock.currentTimeMillis;
    const event = new TaskCanceled({ taskId: cmd.taskId, reason: cmd.reason.trim(), createdAt });
    const labels = labelEvent(open.threads[cmd.taskId], cmd.taskId, "canceled", actor, createdAt);

    return [event, labels, ...wake(open, task.channel, labels.labels, cmd.reason)];
  });

export const decideReopen = (state: State, cmd: { readonly taskId: string }, boardId: string) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const task = open.tasks[cmd.taskId];

    if (task === undefined) return yield* new UnknownTask();

    if (!ownerOrManage(open, task, actor)) return yield* new TaskNotOwned();

    if (task.state !== "failed" && task.state !== "canceled") {
      return yield* new TaskState({ state: task.state });
    }

    const stateName = initialState(open, task.needs);
    const createdAt = yield* Clock.currentTimeMillis;

    return [
      new TaskReopened({ taskId: cmd.taskId, state: stateName, createdAt }),
      labelEvent(open.threads[cmd.taskId], cmd.taskId, stateName, actor, createdAt),
    ];
  });

export const decideAssign = (
  state: State,
  cmd: { readonly taskId: string; readonly assignee?: string; readonly pool: boolean },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const task = open.tasks[cmd.taskId];

    if (task === undefined) return yield* new UnknownTask();

    if (!ownerOrManage(open, task, actor)) return yield* new TaskNotOwned();

    if (!cmd.pool && (cmd.assignee === undefined || !validProfile(cmd.assignee))) {
      return yield* new InvalidPlan({ reason: "for" });
    }

    return [
      new TaskAssigned({
        taskId: cmd.taskId,
        ...(cmd.pool ? {} : { assignee: cmd.assignee }),
        createdAt: yield* Clock.currentTimeMillis,
      }),
    ];
  });

export const decideNeeds = (
  state: State,
  cmd: { readonly taskId: string; readonly needs: ReadonlyArray<string> },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const actor = yield* CurrentActor;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;
    const task = open.tasks[cmd.taskId];

    if (task === undefined) return yield* new UnknownTask();

    if (!ownerOrManage(open, task, actor)) return yield* new TaskNotOwned();

    if (task.state === "claimed" || task.state === "completed" || task.state === "canceled") {
      return yield* new TaskState({ state: task.state });
    }

    for (const need of cmd.needs) {
      if (open.tasks[need] === undefined) return yield* new UnknownTask();
    }

    const stateName = initialState(open, cmd.needs);
    const createdAt = yield* Clock.currentTimeMillis;

    return [
      new TaskNeedsChanged({
        taskId: cmd.taskId,
        needs: [...cmd.needs],
        state: stateName,
        createdAt,
      }),
      labelEvent(open.threads[cmd.taskId], cmd.taskId, stateName, actor, createdAt),
    ];
  });

export const decideMakeTask = (
  state: State,
  cmd: { readonly messageId: string },
  boardId: string,
) =>
  Effect.gen(function* () {
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const message = open.threads[cmd.messageId];

    if (message === undefined || message.messageId !== message.threadId)
      return yield* new UnknownMessage();
    const got = yield* ready(state, boardId, message.channel, "post");

    if (!("open" in got)) return got;

    if (got.open.tasks[cmd.messageId] !== undefined)
      return yield* new TaskState({ state: "ready" });
    const created = new TaskCreated({
      taskId: cmd.messageId,
      channel: message.channel,
      state: "ready",
      ownerId: actorId(got.actor),
      ...(got.actor.profile === undefined ? {} : { ownerProfile: got.actor.profile }),
      needs: [],
      seq: message.seq,
      text: message.body,
      ...authored(got.actor, got.createdAt),
    });

    return [created, labelEvent(message, cmd.messageId, "ready", got.actor, got.createdAt)];
  });

export const claimLost = ClaimLost;
export const nothingReady = NothingReady;
