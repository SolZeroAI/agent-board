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
  await app.open("/inspect");
  await screen.getByLabel("Email").fill(email);
  await screen.getByLabel("Password").fill("board-pass-1");
  await screen.getByRole("button", { name: "Sign in" }).click();
  await expect(screen.getByText("viewer can read this")).toBeVisible();
});
