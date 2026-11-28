import { expect, test } from "e2e";

import { command, login, openBoard, registerAgent, signup } from "./support/board.ts";

const baseOf = (baseUrl: string | undefined) => {
  if (baseUrl === undefined) throw new Error("the local board has no URL");

  return baseUrl;
};

test("the first account owns the team and later accounts need an invite", async ({ app }) => {
  const base = baseOf(app.baseUrl);
  const owner = await signup(base, {
    name: "Owner",
    email: "owner@agent-board.test",
    password: "owner-pass-1",
  });
  expect(owner.role).toBe("owner");
  const closed = await fetch(`${base}/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Stranger",
      email: `${crypto.randomUUID()}@example.test`,
      password: "board-pass-1",
    }),
  });
  expect(closed.status).toBe(403);
  const member = await signup(base, {
    name: "Member",
    email: `${crypto.randomUUID()}@example.test`,
    password: "board-pass-1",
  });
  expect(member.role).toBe("member");
  const again = await login(base, { email: member.email, password: "board-pass-1" });
  expect(again.accountId).toBe(member.accountId);
});

test("a human with manage can register and revoke an agent, and the bound profile is fixed", async ({
  app,
}) => {
  const base = baseOf(app.baseUrl);
  const opened = await openBoard(base, { title: "Agents", agentName: "owner", harness: "cli" });
  const rejected = await fetch(`${base}/agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opened.token}`,
    },
    body: JSON.stringify({
      agentName: "nested",
      harness: "cli",
      boardId: opened.boardId,
    }),
  });
  expect(rejected.status).toBe(422);
  const agent = await registerAgent(
    base,
    opened.humanToken,
    { agentName: "worker", harness: "cli" },
    opened.boardId,
  );
  const mismatched = await fetch(`${base}/api/WhoAmI`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${agent.token}`,
      "x-board-as": "someone-else",
    },
    body: JSON.stringify({ target: "team", input: {} }),
  });
  expect(mismatched.ok).toBe(false);
  const who = JSON.parse(await command(base, agent.token, "WhoAmI", "team", {})) as {
    reply: { kind: string; name: string };
  };
  expect(who.reply.kind).toBe("agent");
  expect(who.reply.name).toBe("worker");
  const revoked = await fetch(`${base}/agents/revoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opened.humanToken}`,
    },
    body: JSON.stringify({ boardId: opened.boardId, agentId: agent.agentId }),
  });
  expect(revoked.ok).toBe(true);
  const after = await fetch(`${base}/api/WhoAmI`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${agent.token}` },
    body: JSON.stringify({ target: "team", input: {} }),
  });
  expect(after.ok).toBe(false);
});
