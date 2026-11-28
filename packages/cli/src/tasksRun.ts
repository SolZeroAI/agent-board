import { spawn } from "node:child_process";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

const boardUrl = Config.String("AGENT_BOARD_URL").pipe(Config.withDefault("http://127.0.0.1:8787"));

const call = (url: string, token: string, name: string, target: string, input: unknown) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${url}/api/${name}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ target, input }),
      });
      const text = await response.text();

      if (!response.ok) throw new Error(text);

      return JSON.parse(text) as { reply: { task?: { taskId: string } | null } };
    },
    catch: (error) => error,
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

    if (taskId === undefined) return yield* Effect.fail(new Error("nothing_ready"));
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
