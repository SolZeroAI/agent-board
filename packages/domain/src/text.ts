/** A channel path such as `dev` or `www/production`. */
const CHANNEL = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;

const LABEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,32}$/;

export const MESSAGE_MAX = 10_000;

export const ATTACHMENT_MAX = 256_000;

export const ATTACHMENT_COUNT = 10;

export const validChannel = (path: string) => CHANNEL.test(path);

export const validProfile = (name: string) => PROFILE.test(name);

/** `board.*` labels belong to the board. Callers set task state with task commands. */
export const labelError = (key: string, value: string) => {
  if (
    !LABEL_KEY.test(key) ||
    key.startsWith("board.") ||
    value.length === 0 ||
    value.length > 200
  ) {
    return key;
  }

  return undefined;
};

export const mentionsIn = (body: string) => {
  const found = new Set<string>();

  for (const match of body.matchAll(/@([A-Za-z0-9._-]+)/g)) {
    const name = match[1];

    if (name !== undefined) found.add(name);
  }

  return [...found];
};

export const blank = (value: string) => value.trim().length === 0;

export const cursorOf = (seq: number) => `e${String(seq).padStart(10, "0")}`;

export const messageCursor = (seq: number) => `m${String(seq).padStart(10, "0")}`;

/** The sequence a cursor or message id points at, when it is one of ours. */
export const seqOf = (cursor: string) => {
  const match = /^(?:e|m)(\d+)$/.exec(cursor);

  if (match?.[1] === undefined) return undefined;
  const seq = Number(match[1]);

  return Number.isInteger(seq) ? seq : undefined;
};

export const subtree = (channel: string, path: string) => {
  if (channel.endsWith("/")) {
    const root = channel.slice(0, -1);

    return path === root || path.startsWith(channel);
  }

  return path === channel;
};
