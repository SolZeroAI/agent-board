import { expect, test } from "e2e";

import { command, createBoard, signup } from "./support/board.ts";

test("the viewer shows a channel thread after sign-in", async ({ app, screen }) => {
  const base = app.baseUrl;

  if (base === undefined) throw new Error("the local board has no URL");
  const email = `${crypto.randomUUID()}@example.test`;
  const human = await signup(base, { name: "Ada", email, password: "board-pass-1" });
  const board = await createBoard(base, human.token, "Viewer");

  await command(base, human.token, "PostMessage", board.boardId, {
    channel: "dev",
    body: "viewer can read this",
  });
  await app.open("/");
  await screen.getByLabel("Email").fill(email);
  await screen.getByLabel("Password").fill("board-pass-1");
  await screen.getByRole("button", { name: "Sign in" }).click();
  await expect(screen.getByText("viewer can read this")).toBeVisible();
});

test("registering an agent shows a one-time setup prompt, and its credential can post over MCP", async ({
  app,
  screen,
}) => {
  const base = app.baseUrl;

  if (base === undefined) throw new Error("the local board has no URL");
  const email = `${crypto.randomUUID()}@example.test`;
  const human = await signup(base, { name: "Ada", email, password: "board-pass-1" });

  await createBoard(base, human.token, "Setup");
  const body = `setup ${crypto.randomUUID()}`;

  await app.open("/");
  await screen.getByLabel("Email").fill(email);
  await screen.getByLabel("Password").fill("board-pass-1");
  await screen.getByRole("button", { name: "Sign in" }).click();
  await screen.getByRole("button", { name: "Register an agent" }).click();
  await screen.getByLabel("Agent name").fill("setup-agent");
  await screen.getByRole("button", { name: "Create credential" }).click();
  const prompt = await screen.getByRole("region", { name: "Agent setup" }).textContent();
  const mcp = prompt?.match(/MCP URL: (\S+)/)?.[1];
  const token = prompt?.match(/Credential: (\S+)/)?.[1];

  expect(prompt).toContain("shown only once");
  expect(prompt).toContain("Claude Code");
  expect(prompt).toContain("Generic MCP client");
  expect(prompt).toContain("CLI");
  expect(mcp).toBe(`${base}/mcp`);
  expect(token).toBeTruthy();
  const posted = await fetch(mcp!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "post_message",
        arguments: { channel: "dev", body },
      },
    }),
  });
  const postedText = await posted.text();

  if (!posted.ok || postedText.includes('"isError":true') || postedText.includes('"error"')) {
    throw new Error(postedText);
  }

  await expect(screen.getByText(body)).toBeVisible();
});
