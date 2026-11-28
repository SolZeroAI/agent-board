export interface BoardOptions {
  readonly url?: string;
  readonly token?: string;
  readonly boardId?: string;
  readonly as?: string;
}

export interface BoardClient {
  readonly post: (
    channel: string,
    text: string,
    input?: { readonly labels?: Readonly<Record<string, string>> },
  ) => Promise<{ readonly messageId: string }>;
  readonly reply: (messageId: string, text: string) => Promise<{ readonly messageId: string }>;
  readonly read: (
    channel: string,
  ) => Promise<{ readonly messages: ReadonlyArray<{ readonly body: string }> }>;
  readonly wait: (input: {
    readonly target: string;
    readonly after?: string;
    readonly timeoutMs?: number;
  }) => Promise<{ readonly event: { readonly summary?: string } | null }>;
  readonly tasks: {
    readonly create: (
      channel: string,
      text: string,
      input?: { readonly needs?: ReadonlyArray<string> },
    ) => Promise<{ readonly taskId: string }>;
    readonly complete: (taskId: string, result: string) => Promise<void>;
  };
}

const root = (options: BoardOptions | undefined) => options?.url ?? "http://127.0.0.1:8787";

const headers = (options: BoardOptions | undefined) => {
  const value = new Headers({ "content-type": "application/json" });

  if (options?.token !== undefined) value.set("authorization", `Bearer ${options.token}`);

  if (options?.as !== undefined) value.set("x-board-as", options.as);

  return value;
};

const call = async (options: BoardOptions | undefined, path: string, body: unknown) => {
  const response = await fetch(`${root(options)}${path}`, {
    method: "POST",
    headers: headers(options),
    body: JSON.stringify(body),
  });
  const text = await response.text();

  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${text}`);

  return JSON.parse(text) as { reply?: Record<string, unknown> };
};

/** A client for one board deployment. `as` sets the profile header. */
export const board = (options?: BoardOptions): BoardClient => ({
  post: async (channel, text, input) => {
    const result = await call(options, "/api/PostMessage", {
      target: options?.boardId,
      input: { channel, body: text, ...input },
    });

    return { messageId: String(result.reply?.messageId ?? "") };
  },
  reply: async (messageId, text) => {
    const result = await call(options, "/api/ReplyMessage", {
      target: options?.boardId,
      input: { messageId, body: text },
    });

    return { messageId: String(result.reply?.messageId ?? "") };
  },
  read: async (channel) => {
    const result = await call(options, "/api/ReadChannel", {
      target: options?.boardId,
      input: { channel },
    });
    const messages = result.reply?.messages;

    return { messages: Array.isArray(messages) ? messages : [] };
  },
  wait: async (input) => {
    const result = await call(options, "/wait", input);

    return { event: (result as { event?: { summary?: string } | null }).event ?? null };
  },
  tasks: {
    create: async (channel, text, input) => {
      const result = await call(options, "/api/CreateTask", {
        target: options?.boardId,
        input: { channel, text, ...input },
      });

      return { taskId: String(result.reply?.taskId ?? "") };
    },
    complete: async (taskId, result) => {
      await call(options, "/api/CompleteTask", {
        target: options?.boardId,
        input: { taskId, result },
      });
    },
  },
});
