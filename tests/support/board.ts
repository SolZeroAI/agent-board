import * as Schema from "effect/Schema";

export interface OpenedAgent {
  readonly boardId: string;
  readonly agentId: string;
  readonly token: string;
}

export interface WorkItem {
  readonly itemId: string;
  readonly title: string;
  readonly body: string;
  readonly status: "open" | "claimed" | "done" | "failed";
  readonly seq: number;
  readonly claimGeneration: number;
  readonly claimantId?: string;
}

const Opened = Schema.Struct({
  boardId: Schema.String,
  agentId: Schema.String,
  token: Schema.String,
});

const Item = Schema.Struct({
  itemId: Schema.String,
  title: Schema.String,
  body: Schema.String,
  status: Schema.Literals(["open", "claimed", "done", "failed"]),
  seq: Schema.Number,
  claimGeneration: Schema.Number,
  claimantId: Schema.optional(Schema.String),
});

const ClaimReply = Schema.Struct({
  reply: Schema.Struct({ item: Schema.NullOr(Item) }),
});

const MessageReply = Schema.Struct({
  reply: Schema.Struct({ messageId: Schema.String, seq: Schema.Number }),
});

const Queue = Schema.Struct({ items: Schema.Array(Item) });

const Messages = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ messageId: Schema.String, body: Schema.String })),
});

const decode = <A>(schema: Schema.Decoder<A>, text: string): A =>
  Schema.decodeUnknownSync(schema)(JSON.parse(text));

const post = async (url: string, body: unknown, token?: string) => {
  const headers = new Headers({ "content-type": "application/json" });

  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await response.text();

  if (!response.ok) throw new Error(`${url} failed (${response.status}): ${text}`);

  return text;
};

const get = async (url: string, token: string) => {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const text = await response.text();

  if (!response.ok) throw new Error(`${url} failed (${response.status}): ${text}`);

  return text;
};

export interface Account {
  readonly accountId: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly token: string;
}

const AccountBody = Schema.Struct({
  accountId: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.String,
  token: Schema.String,
});

const BoardBody = Schema.Struct({ boardId: Schema.String });

export const signup = async (
  baseUrl: string,
  input: { name: string; email: string; password: string },
): Promise<Account> => decode(AccountBody, await post(`${baseUrl}/accounts`, input));

export const login = async (
  baseUrl: string,
  input: { email: string; password: string },
): Promise<Account> => decode(AccountBody, await post(`${baseUrl}/login`, input));

export const createBoard = async (baseUrl: string, token: string, title: string) =>
  decode(BoardBody, await post(`${baseUrl}/boards`, { title }, token));

export const openBoard = async (
  baseUrl: string,
  input: { title: string; agentName: string; harness: string },
): Promise<OpenedAgent> => {
  const human = await signup(baseUrl, {
    name: input.agentName,
    email: `${crypto.randomUUID()}@example.test`,
    password: "board-pass-1",
  });
  const board = await createBoard(baseUrl, human.token, input.title);

  return registerAgent(baseUrl, human.token, input, board.boardId);
};

export const registerAgent = async (
  baseUrl: string,
  token: string,
  input: { agentName: string; harness: string },
  boardId?: string,
): Promise<OpenedAgent> =>
  decode(
    Opened,
    await post(`${baseUrl}/agents`, boardId === undefined ? input : { ...input, boardId }, token),
  );

export const postWork = async (
  baseUrl: string,
  token: string,
  boardId: string,
  input: { itemId: string; title: string; body: string },
) => {
  await command(baseUrl, token, "PostWork", boardId, input);
};

export const claimNext = async (baseUrl: string, token: string, boardId: string, leaseMs: number) =>
  decode(ClaimReply, await command(baseUrl, token, "ClaimNext", boardId, { leaseMs })).reply;

export const completeWork = async (
  baseUrl: string,
  token: string,
  boardId: string,
  itemId: string,
) => {
  await command(baseUrl, token, "CompleteWork", boardId, { itemId });
};

export const releaseWork = async (
  baseUrl: string,
  token: string,
  boardId: string,
  itemId: string,
) => {
  await command(baseUrl, token, "ReleaseWork", boardId, { itemId });
};

export const failWork = async (
  baseUrl: string,
  token: string,
  boardId: string,
  itemId: string,
  reason: string,
) => {
  await command(baseUrl, token, "FailWork", boardId, { itemId, reason });
};

export const sendMessage = async (
  baseUrl: string,
  token: string,
  boardId: string,
  input: { messageId: string; body: string; toAgentId?: string; itemId?: string },
) =>
  decode(MessageReply, await command(baseUrl, token, "SendMessage", boardId, withoutEmpty(input)))
    .reply;

export const workQueue = async (baseUrl: string, token: string, boardId: string) =>
  decode(Queue, await get(`${baseUrl}/api/WorkQueue/${encodeURIComponent(boardId)}`, token)).items;

export const inbox = async (baseUrl: string, token: string, agentId: string) =>
  decode(Messages, await get(`${baseUrl}/api/Inbox/${encodeURIComponent(agentId)}`, token))
    .messages;

export const itemThread = async (baseUrl: string, token: string, itemId: string) =>
  decode(Messages, await get(`${baseUrl}/api/ItemThread/${encodeURIComponent(itemId)}`, token))
    .messages;

export const command = (
  baseUrl: string,
  token: string,
  name: string,
  target: string,
  input: unknown,
) => post(`${baseUrl}/api/${name}`, { target, input }, token);

const withoutEmpty = (input: {
  messageId: string;
  body: string;
  toAgentId?: string;
  itemId?: string;
}) => {
  const fields = { messageId: input.messageId, body: input.body };

  if (input.toAgentId !== undefined && input.itemId !== undefined) {
    return { ...fields, toAgentId: input.toAgentId, itemId: input.itemId };
  }

  if (input.toAgentId !== undefined) return { ...fields, toAgentId: input.toAgentId };

  if (input.itemId !== undefined) return { ...fields, itemId: input.itemId };

  return fields;
};
