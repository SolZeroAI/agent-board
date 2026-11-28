// @ts-nocheck
/** View shapes the ported inspector reads. The board client fills them from our API. */

export type ScheduleTiming = { at?: string; every?: string; until?: string };

export type Attachment = {
  id: string;
  name: string;
  mediaType?: string;
  size?: number;
  url?: string;
};

export type Author = {
  name: string;
  platform?: string;
  avatar?: string;
  via?: { name: string; environment: string | null };
};

export type TaskView = {
  state: "waiting" | "ready" | "claimed" | "blocked" | "completed" | "failed" | "canceled";
  epoch: number;
  claim: { until: string } | null;
  owner?: string;
  for?: string | null;
  needs?: string[];
  result?: string;
  reason?: string;
};

export type MessageView = {
  id: string;
  text: string;
  deleted: boolean;
  reactions: Record<string, string[]>;
  labels: Record<string, string>;
  channel: string;
  re: string | null;
  version: number;
  by: { actor: string };
  createdAt: string;
  from: string | null;
  author?: Author;
  task?: TaskView;
  schedule?: { id: string };
  blocks?: BlockView[];
  attachments?: Attachment[];
  editedAt?: string;
};

export type BlockView = { schema?: string; data?: unknown; title?: string };

export type ChannelView = {
  path: string;
  lastIndex?: number;
  messages?: number;
  threads?: number;
  private?: boolean;
};

export type ActorView = {
  id?: string;
  kind?: string;
  handle?: string;
  name: string;
  avatar?: string;
  via?: { name: string; environment: string | null };
  platform?: string;
};

export type Me = {
  actor: string;
  principal: string;
  profile: string | null;
  handle: string;
  name?: string;
  avatar?: string;
  via?: { name: string; environment: string | null };
  can: Array<{
    pattern: string;
    permissions: Array<"read" | "post" | "react" | "label" | "manage">;
  }>;
};

export type BoardEventView = {
  type: string;
  cursor: string;
  message?: MessageView;
  payload: Record<string, string | undefined> & {
    channel?: string;
    actor?: string;
    kind?: string;
    handle?: string;
    name?: string;
    avatar?: string;
    via?: string;
    platform?: string;
  };
};

export type Discovery = { name?: string; sync?: Array<{ key: string; platform: string }> } | null;

export type GrantView = {
  id: string;
  pattern: string;
  permissions: string[];
  principals: Array<Record<string, string>>;
};

export type SchemaView = { id: string; name: string; schema?: unknown };

export type ScheduleView = { id: string; channel?: string; text?: string; canceled?: boolean };

export type RegistrationView = { id: string; url?: string };

export type InboxEntry = { id: string; text?: string };

export type ThreadsPage = {
  threads: Array<{ message: MessageView; last?: MessageView; replies: number }>;
  older?: string | null;
};

export type MessagesPage = { messages: MessageView[] };

export type Explanation = {
  pattern?: string | null;
  can?: string[];
  level?: string;
  over?: string[];
  capped?: string | null;
};

export type GrantInput = { principals: unknown[]; pattern: string; permissions: string[] };

export type GrantWriteOptions = Record<string, unknown>;

export type SchemaInput = { name: string; schema: unknown };

export type SyncedView = { targets: Array<{ platform: string; url?: string }> };

export type PrincipalView = { name?: string };

export type PrincipalInput =
  | { kind: "user"; email?: string; userId?: string }
  | { kind: "project"; project: string; environments?: string[] }
  | { kind: "github"; repository: string; workflow?: string; branch?: string }
  | { kind: "app"; app: string }
  | { kind: string };

export type ExplainPrincipal = Record<string, string>;

export type PostOptions = {
  text: string;
  labels?: Record<string, string>;
  noSync?: boolean;
  attachments?: Attachment[];
};

export type EventsState = "live" | "retrying";

export class BoardError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type Listed<T> =
  | { is: "unasked" }
  | { is: "ready"; items: T[] }
  | { is: "refused"; reason: string };

export type GrantCan = string;
