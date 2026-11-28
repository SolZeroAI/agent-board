import { expect, test } from "e2e";

import {
  claimNext,
  completeWork,
  failWork,
  inbox,
  itemThread,
  openBoard,
  postWork,
  registerAgent,
  releaseWork,
  sendMessage,
  workQueue,
} from "./support/board.ts";

const baseOf = (baseUrl: string | undefined) => {
  if (baseUrl === undefined) throw new Error("the local board has no URL");

  return baseUrl;
};

test("agents post work and read it back on the queue", async ({ app }) => {
  const base = baseOf(app.baseUrl);
  await app.open("/health");

  const owner = await openBoard(base, {
    title: "Post",
    agentName: "poster",
    harness: "cli",
  });

  const itemId = crypto.randomUUID();
  await postWork(base, owner.token, owner.boardId, {
    itemId,
    title: "Write the notes",
    body: "Summarize the board.",
  });
  const items = await workQueue(base, owner.token, owner.boardId);
  expect(items.map((item) => item.itemId)).toEqual([itemId]);
  expect(items[0]?.status).toBe("open");
});

test("two agents cannot claim the same work item", async ({ app }) => {
  const base = baseOf(app.baseUrl);

  const owner = await openBoard(base, {
    title: "Claim",
    agentName: "owner",
    harness: "cli",
  });

  const peer = await registerAgent(
    base,
    owner.humanToken,
    { agentName: "peer", harness: "mcp" },
    owner.boardId,
  );
  const itemId = crypto.randomUUID();
  await postWork(base, owner.token, owner.boardId, {
    itemId,
    title: "Only once",
    body: "One agent may hold this.",
  });

  const [first, second] = await Promise.all([
    claimNext(base, owner.token, owner.boardId, 60_000),
    claimNext(base, peer.token, owner.boardId, 60_000),
  ]);

  const claimed = [first.item, second.item].filter((item) => item !== null);
  expect(claimed).toHaveLength(1);
  expect(claimed[0]?.itemId).toBe(itemId);
  expect(claimed[0]?.status).toBe("claimed");
});

test("an agent completes, fails, or releases claimed work", async ({ app }) => {
  const base = baseOf(app.baseUrl);

  const owner = await openBoard(base, {
    title: "Finish",
    agentName: "owner",
    harness: "cli",
  });

  const doneId = crypto.randomUUID();
  const failedId = crypto.randomUUID();
  const releasedId = crypto.randomUUID();
  await postWork(base, owner.token, owner.boardId, {
    itemId: doneId,
    title: "Done",
    body: "Finish me.",
  });
  await postWork(base, owner.token, owner.boardId, {
    itemId: failedId,
    title: "Fail",
    body: "This one fails.",
  });
  await postWork(base, owner.token, owner.boardId, {
    itemId: releasedId,
    title: "Release",
    body: "Put me back.",
  });
  const done = await claimNext(base, owner.token, owner.boardId, 60_000);
  expect(done.item?.itemId).toBe(doneId);
  await completeWork(base, owner.token, owner.boardId, doneId);
  const failed = await claimNext(base, owner.token, owner.boardId, 60_000);
  expect(failed.item?.itemId).toBe(failedId);
  await failWork(base, owner.token, owner.boardId, failedId, "blocked");
  const released = await claimNext(base, owner.token, owner.boardId, 60_000);
  expect(released.item?.itemId).toBe(releasedId);
  await releaseWork(base, owner.token, owner.boardId, releasedId);
  const again = await claimNext(base, owner.token, owner.boardId, 60_000);
  expect(again.item?.itemId).toBe(releasedId);
  const items = await workQueue(base, owner.token, owner.boardId);
  expect(items.find((item) => item.itemId === doneId)?.status).toBe("done");
  expect(items.find((item) => item.itemId === failedId)?.status).toBe("failed");
});

test("a lease expires and another agent can claim the item", async ({ app }) => {
  const base = baseOf(app.baseUrl);

  const owner = await openBoard(base, {
    title: "Lease",
    agentName: "owner",
    harness: "cli",
  });

  const peer = await registerAgent(
    base,
    owner.humanToken,
    { agentName: "peer", harness: "mcp" },
    owner.boardId,
  );
  const itemId = crypto.randomUUID();
  await postWork(base, owner.token, owner.boardId, {
    itemId,
    title: "Expires",
    body: "The lease is short.",
  });
  const held = await claimNext(base, owner.token, owner.boardId, 1000);
  expect(held.item?.itemId).toBe(itemId);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const taken = await claimNext(base, peer.token, owner.boardId, 60_000);
  expect(taken.item?.itemId).toBe(itemId);
  expect(taken.item?.claimantId).toBe(peer.agentId);
});

test("agents send messages to each other and to a work item", async ({ app }) => {
  const base = baseOf(app.baseUrl);

  const owner = await openBoard(base, {
    title: "Mail",
    agentName: "owner",
    harness: "cli",
  });

  const peer = await registerAgent(
    base,
    owner.humanToken,
    { agentName: "peer", harness: "mcp" },
    owner.boardId,
  );
  const itemId = crypto.randomUUID();
  await postWork(base, owner.token, owner.boardId, {
    itemId,
    title: "Discuss",
    body: "Talk on the item.",
  });
  const directId = crypto.randomUUID();
  const threadId = crypto.randomUUID();
  await sendMessage(base, owner.token, owner.boardId, {
    messageId: directId,
    toAgentId: peer.agentId,
    body: "Your turn.",
  });
  await sendMessage(base, owner.token, owner.boardId, {
    messageId: threadId,
    itemId,
    body: "See the notes.",
  });
  const messages = await inbox(base, peer.token, peer.agentId);
  expect(messages.map((message) => message.messageId)).toContain(directId);
  const thread = await itemThread(base, peer.token, itemId);
  expect(thread.map((message) => message.messageId)).toContain(threadId);
});
