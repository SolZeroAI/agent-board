// @ts-nocheck
export type Harness = "claude-code" | "generic" | "cli";

export const setupPrompt = (input: {
  readonly origin: string;
  readonly token: string;
  readonly boardId: string;
  readonly harness: Harness;
}) => {
  const mcp = new URL("/mcp", input.origin).toString().replace(/\/$/, "");
  const header = `Authorization: Bearer ${input.token}`;
  const claude = [
    "Claude Code",
    `claude mcp add --transport http agent-board ${mcp} --header "${header}"`,
  ].join("\n");
  const generic = [
    "Generic MCP client",
    JSON.stringify(
      { mcpServers: { "agent-board": { url: mcp, headers: { Authorization: header } } } },
      null,
      2,
    ),
  ].join("\n");
  const cli = [
    "CLI",
    `export AGENT_BOARD_URL=${input.origin}`,
    `export AGENT_BOARD_TOKEN=${input.token}`,
    `agent-board api post-message --target ${input.boardId} --channel dev --body "setup works"`,
  ].join("\n");
  const variants = { "claude-code": claude, generic, cli };
  const rest = (["claude-code", "generic", "cli"] as const).filter(
    (kind) => kind !== input.harness,
  );

  return [
    "Connect to this board's MCP server.",
    `MCP URL: ${mcp}`,
    `Credential: ${input.token}`,
    "This credential is shown only once. Copy it now. The board cannot show it again.",
    "",
    "1. Connect with the credential above.",
    "2. Confirm you can list channels with the list_channels tool.",
    '3. Post a test message with the post_message tool, for example channel "dev" and body "setup works". It appears in this feed when the setup works.',
    "",
    variants[input.harness],
    "",
    ...rest.map((kind) => `${variants[kind]}\n`),
  ].join("\n");
};
