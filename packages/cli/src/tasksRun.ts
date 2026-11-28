import { spawn } from "node:child_process";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const boardUrl = Config.String("AGENT_BOARD_URL").pipe(Config.withDefault("http://127.0.0.1:8787"));

class BoardCallFailed extends Schema.TaggedError<
  BoardCallFailed,
  { readonly brand: unique symbol }
>()("BoardCallFailed", {
  command: Schema.String,
  detail: Schema.String,
}) {}

class NothingReady extends Schema.TaggedError<NothingReady, { readonly brand: unique symbol }>()(
  "NothingReady",
  {},
) {}

const Reply = Schema.Struct({
  reply: Schema.Struct({
    task: Schema.optional(Schema.NullOr(Schema.Struct({ taskId: Schema.String }))),
  }),
});

const detailOf = (cause: unknown) => (cause instanceof Error ? cause.message : "Board call failed");

const call = (url: string, token: string, name: string, target: string, input: unknown) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${url}/api/${name}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ target, input }),
        }),
      catch: (cause) => new BoardCallFailed({ command: name, detail: detailOf(cause) }),
    });
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => new BoardCallFailed({ command: name, detail: detailOf(cause) }),
    });

    if (!response.ok) return yield* new BoardCallFailed({ command: name, detail: text });

    return yield* Schema.decodeEffect(Schema.fromJsonString(Reply))(text).pipe(
      Effect.mapError(() => new BoardCallFailed({ command: name, detail: text })),
    );
  });

/**
 * Claim a task, run a command, renew the lease while it runs, and settle
 * from the exit code. Exit 0 completes the task. Any other code fails it.
 */
export const runClaimed = (input: {
  readonly boardId: string;
  readonly taskId?: string;
  readonly channel?: string;
  readonly command: ReadonlyArray<string>;
  readonly leaseMs: number;
  readonly result: string;
}) =>
  Effect.gen(function* () {
    const url = yield* boardUrl;
    const token = yield* Config.String("AGENT_BOARD_TOKEN");
    const claimed =
      input.taskId === undefined
        ? yield* call(url, token, "ClaimReady", input.boardId, {
            channel: input.channel ?? "work/",
            leaseMs: input.leaseMs,
          })
        : yield* call(url, token, "ClaimTask", input.boardId, {
            taskId: input.taskId,
            leaseMs: input.leaseMs,
          });
    const taskId = input.taskId ?? claimed.reply.task?.taskId;

    if (taskId === undefined) return yield* new NothingReady();
    const code = yield* Effect.promise(
      () =>
        new Promise<number>((resolve) => {
          const [bin, ...args] = input.command;
          const child = spawn(bin ?? "true", args, {
            stdio: "inherit",
            env: { ...process.env, BOARD_TASK: taskId },
          });
          const timer = setInterval(
            () => {
              void fetch(`${url}/api/RenewTask`, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  target: input.boardId,
                  input: { taskId, leaseMs: input.leaseMs },
                }),
              });
            },
            Math.max(250, Math.floor(input.leaseMs / 3)),
          );

          child.on("exit", (status) => {
            clearInterval(timer);
            resolve(status ?? 1);
          });
        }),
    );

    if (code === 0) {
      yield* call(url, token, "CompleteTask", input.boardId, { taskId, result: input.result });

      return 0;
    }

    yield* call(url, token, "FailTask", input.boardId, { taskId, reason: `exit ${code}` });

    return code;
  });
