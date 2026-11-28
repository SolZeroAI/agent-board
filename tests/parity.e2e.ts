import { createServer } from "node:http";

import { expect, test } from "e2e";

import { command, createBoard, login, signup } from "./support/board.ts";

const baseOf = (baseUrl: string | undefined) => {
  if (baseUrl === undefined) throw new Error("the local board has no URL");

  return baseUrl;
};

const account = (base: string, name: string) =>
  signup(base, {
    name,
    email: `${crypto.randomUUID()}@example.test`,
    password: "board-pass-1",
  });

const replyOf = async (response: Response) => {
  const text = await response.text();

  if (!response.ok) throw new Error(`${response.status} ${text}`);

  return JSON.parse(text) as { reply: Record<string, unknown> };
};

test("a channel thread can be posted, replied, edited, and deleted", async ({ app }) => {
  const base = baseOf(app.baseUrl);
  const human = await account(base, "Ada");
  const board = await createBoard(base, human.token, "Threads");
  const posted = JSON.parse(
    await command(base, human.token, "PostMessage", board.boardId, {
      channel: "dev",
      body: "is the deploy done?",
    }),
  ) as { reply: { messageId: string } };

  await command(base, human.token, "ReplyMessage", board.boardId, {
    messageId: posted.reply.messageId,
    body: "shipping now",
  });
  await command(base, human.token, "EditMessage", board.boardId, {
    messageId: posted.reply.messageId,
    body: "is the deploy done yet?",
  });
  const beforeDelete = JSON.parse(
    await command(base, human.token, "ReadThread", board.boardId, {
      messageId: posted.reply.messageId,
    }),
  ) as { reply: { messages: Array<{ body: string }> } };
  expect(beforeDelete.reply.messages.map((message) => message.body)).toEqual([
    "is the deploy done yet?",
    "shipping now",
  ]);
  await command(base, human.token, "DeleteMessage", board.boardId, {
    messageId: posted.reply.messageId,
  });
  const after = JSON.parse(
    await command(base, human.token, "ReadThread", board.boardId, {
      messageId: posted.reply.messageId,
    }),
  ) as { reply: { messages: Array<{ deleted: boolean; body: string }> } };
  expect(after.reply.messages[0]?.deleted).toBe(true);
  expect(after.reply.messages[0]?.body).toBe("");
});

test("labels filter a channel read and a reserved label is rejected", async ({ app }) => {
  const base = baseOf(app.baseUrl);
  const human = await account(base, "Ada");
  const board = await createBoard(base, human.token, "Labels");

  await command(base, human.token, "PostMessage", board.boardId, {
    channel: "dev",
    body: "a bug",
    labels: { kind: "bug" },
  });
  await command(base, human.token, "PostMessage", board.boardId, {
    channel: "dev",
    body: "a note",
    labels: { kind: "note" },
  });
  const bugs = JSON.parse(
    await command(base, human.token, "ReadChannel", board.boardId, {
      channel: "dev",
      labelKey: "kind",
      labelValue: "bug",
    }),
  ) as { reply: { messages: Array<{ body: string }> } };
  expect(bugs.reply.messages.map((message) => message.body)).toEqual(["a bug"]);
  const reserved = await fetch(`${base}/api/SetLabels`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${human.token}` },
    body: JSON.stringify({
      target: board.boardId,
      input: { messageId: "m0000000001", set: { "board.task": "ready" } },
    }),
  });
  expect(reserved.status).toBe(400);
});

test("board creation requires a login, and a private channel hides from other people", async ({
  app,
}) => {
  const base = baseOf(app.baseUrl);
  const open = await fetch(`${base}/boards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "nope" }),
  });
  expect(open.status).toBe(401);
  const owner = await account(base, "Ada");
  const other = await account(base, "Bea");
  const again = await login(base, { email: owner.email, password: "board-pass-1" });
  expect(again.accountId).toBe(owner.accountId);
  const board = await createBoard(base, owner.token, "Access");
  const who = JSON.parse(await command(base, owner.token, "WhoAmI", "team", {})) as {
    reply: { kind: string; name: string };
  };
  expect(who.reply.kind).toBe("human");
  expect(who.reply.name).toBe("Ada");
  await command(base, owner.token, "CreateChannel", board.boardId, {
    path: "security",
    isPrivate: true,
  });
  const hidden = await fetch(`${base}/api/ReadChannel`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${other.token}` },
    body: JSON.stringify({ target: board.boardId, input: { channel: "security" } }),
  });
  expect(hidden.status).toBe(403);
  const actors = JSON.parse(await command(base, owner.token, "ReadActors", board.boardId, {})) as {
    reply: { actors: Array<{ name: string }> };
  };
  expect(actors.reply.actors.map((actor) => actor.name)).toContain("Ada");
});

test("the event log is ordered and wait returns the next matching event", async ({ app }) => {
  const base = baseOf(app.baseUrl);
  const human = await account(base, "Ada");
  const board = await createBoard(base, human.token, "Events");
  const first = JSON.parse(
    await command(base, human.token, "PostMessage", board.boardId, {
      channel: "dev",
      body: "one",
    }),
  ) as { reply: { messageId: string } };

  await command(base, human.token, "PostMessage", board.boardId, { channel: "dev", body: "two" });
  const page = JSON.parse(
    await command(base, human.token, "ReadFeed", board.boardId, { after: first.reply.messageId }),
  ) as { reply: { events: Array<{ summary: string; cursor: string }> } };
  expect(page.reply.events.some((event) => event.summary === "two")).toBe(true);
  const waiting = fetch(`${base}/wait`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${human.token}` },
    body: JSON.stringify({
      target: board.boardId,
      after: page.reply.events.at(-1)?.cursor,
      channel: "dev",
      timeoutMs: 5000,
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 300));
  await command(base, human.token, "PostMessage", board.boardId, { channel: "dev", body: "three" });
  const woken = await replyOf(await waiting);
  expect(JSON.stringify(woken)).toContain("three");
});

test("tasks wait on needs, claim, complete with a result, and a plan is idempotent", async ({
  app,
}) => {
  const base = baseOf(app.baseUrl);
  const human = await account(base, "Ada");
  const board = await createBoard(base, human.token, "Tasks");
  const fix = JSON.parse(
    await command(base, human.token, "CreateTask", board.boardId, {
      channel: "work",
      text: "fix the flaky test",
      labels: { step: "fix" },
    }),
  ) as { reply: { taskId: string } };
  const review = JSON.parse(
    await command(base, human.token, "CreateTask", board.boardId, {
      channel: "work",
      text: "review the fix",
      needs: [fix.reply.taskId],
    }),
  ) as { reply: { taskId: string } };
  const waiting = JSON.parse(
    await command(base, human.token, "ReadTasks", board.boardId, { taskState: "waiting" }),
  ) as { reply: { tasks: Array<{ taskId: string }> } };
  expect(waiting.reply.tasks.map((task) => task.taskId)).toContain(review.reply.taskId);
  const claimed = JSON.parse(
    await command(base, human.token, "ClaimReady", board.boardId, {
      channel: "work/",
      leaseMs: 60_000,
      labelKey: "step",
      labelValue: "fix",
    }),
  ) as { reply: { task: { taskId: string; state: string } | null } };
  expect(claimed.reply.task?.taskId).toBe(fix.reply.taskId);
  expect(claimed.reply.task?.state).toBe("claimed");
  await command(base, human.token, "CompleteTask", board.boardId, {
    taskId: fix.reply.taskId,
    result: "fixed in a1b2c3",
  });
  const ready = JSON.parse(
    await command(base, human.token, "ReadTasks", board.boardId, { taskState: "ready" }),
  ) as { reply: { tasks: Array<{ taskId: string }> } };
  expect(ready.reply.tasks.map((task) => task.taskId)).toContain(review.reply.taskId);
  const plan = JSON.parse(
    await command(base, human.token, "CreatePlan", board.boardId, {
      channel: "work",
      idempotencyKey: "cve-1",
      tasks: [{ key: "ship", text: "ship it" }],
    }),
  ) as { reply: { taskIds: string[]; created: boolean } };
  const replay = JSON.parse(
    await command(base, human.token, "CreatePlan", board.boardId, {
      channel: "work",
      idempotencyKey: "cve-1",
      tasks: [{ key: "ship", text: "ship it" }],
    }),
  ) as { reply: { taskIds: string[]; created: boolean } };
  expect(plan.reply.created).toBe(true);
  expect(replay.reply.created).toBe(false);
  expect(replay.reply.taskIds).toEqual(plan.reply.taskIds);
  await command(base, human.token, "CancelTask", board.boardId, {
    taskId: review.reply.taskId,
    reason: "superseded",
  });
});

test("schemas, reactions, mentions, attachments, and a watcher callback", async ({ app }) => {
  const base = baseOf(app.baseUrl);
  const human = await account(base, "Ada");
  const board = await createBoard(base, human.token, "Extras");
  const seen: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.push(Buffer.concat(chunks).toString("utf8"));
      response.end("ok");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;

  await command(base, human.token, "RegisterSchema", board.boardId, {
    schemaId: "security-finding@1",
    description: "A security finding.",
    document: JSON.stringify({
      type: "object",
      required: ["severity"],
      properties: { severity: { type: "string" } },
      additionalProperties: false,
    }),
  });
  await command(base, human.token, "PostMessage", board.boardId, {
    channel: "dev",
    body: JSON.stringify({ severity: "high" }),
    schemaId: "security-finding@1",
    dataJson: JSON.stringify({ severity: "high" }),
  });
  const posted = JSON.parse(
    await command(base, human.token, "PostMessage", board.boardId, {
      channel: "dev",
      body: "@Ada please look",
    }),
  ) as { reply: { messageId: string } };

  await command(base, human.token, "ReactToMessage", board.boardId, {
    messageId: posted.reply.messageId,
    emoji: "eyes",
  });
  await command(base, human.token, "AddAttachment", board.boardId, {
    messageId: posted.reply.messageId,
    attachment: {
      attachmentId: "file-1",
      name: "note.txt",
      mediaType: "text/plain",
      dataBase64: btoa("hello"),
    },
  });
  const file = JSON.parse(
    await command(base, human.token, "ReadAttachment", board.boardId, { attachmentId: "file-1" }),
  ) as { reply: { name: string; dataBase64: string } };
  expect(file.reply.name).toBe("note.txt");
  expect(file.reply.dataBase64).toBe(btoa("hello"));
  await command(base, human.token, "RegisterWatcher", board.boardId, {
    watcherId: "hook",
    url: `http://127.0.0.1:${port}/hook`,
    channel: "dev",
    kinds: ["reply"],
  });
  await command(base, human.token, "ReplyMessage", board.boardId, {
    messageId: posted.reply.messageId,
    body: "waking the hook",
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(seen.join("")).toContain("waking the hook");
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  const mentions = JSON.parse(
    await command(base, human.token, "ReadFeed", board.boardId, { mention: "Ada" }),
  ) as { reply: { events: Array<{ summary: string }> } };
  expect(mentions.reply.events.some((event) => event.summary.includes("@Ada"))).toBe(true);
});
