import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { Actor } from "./Actor.ts";
import { CurrentActor } from "./CurrentActor.ts";
import { AccountId, BoardId, DirectoryId } from "./ids.ts";
import { sameSecret } from "./password.ts";
import { AccountExists, BadCredentials, InvalidWork, WeakPassword } from "./rejections.ts";
import { Session } from "./Session.ts";
import { blank } from "./text.ts";

const Account = Schema.Struct({
  accountId: AccountId,
  name: Schema.String,
  email: Schema.String,
  passwordHash: Schema.String,
  role: Schema.Literals(["owner", "member"]),
});

const BoardRef = Schema.Struct({
  boardId: BoardId,
  title: Schema.String,
  ownerId: AccountId,
});

const State = Schema.Struct({
  accounts: Schema.Record(Schema.String, Account),
  boards: Schema.Record(Schema.String, BoardRef),
});

type State = typeof State.Type;

export class AccountRegistered extends Domain.Event("AccountRegistered", {
  accountId: AccountId,
  name: Schema.String,
  email: Schema.String,
  passwordHash: Schema.String,
  role: Schema.Literals(["owner", "member"]),
}) {}

export class BoardNoted extends Domain.Event("BoardNoted", {
  boardId: BoardId,
  title: Schema.String,
  ownerId: AccountId,
}) {}

export class AccountAuthenticated extends Domain.Event("AccountAuthenticated", {
  accountId: AccountId,
  name: Schema.String,
  email: Schema.String,
  role: Schema.Literals(["owner", "member"]),
}) {}

export class IdentityRead extends Domain.Event("IdentityRead", {
  kind: Schema.Literals(["human", "agent"]),
  actorId: Schema.String,
  name: Schema.String,
  role: Schema.String,
  email: Schema.optional(Schema.String),
  profile: Schema.optional(Schema.String),
  boardId: Schema.optional(Schema.String),
}) {}

const emailOf = (value: string) => value.trim().toLowerCase();

/** Create a human account. The first account is the team owner. */
export class RegisterAccount extends Domain.Command("RegisterAccount", {
  target: DirectoryId,
  input: {
    accountId: AccountId,
    name: Schema.String,
    email: Schema.String,
    passwordHash: Schema.String,
  },
  events: [AccountRegistered],
  rejects: [AccountExists, WeakPassword, InvalidWork],
  reply: {
    accountId: AccountId,
    name: Schema.String,
    email: Schema.String,
    role: Schema.Literals(["owner", "member"]),
  },
}) {}

export class LoginLookedUp extends Domain.Event("LoginLookedUp", { email: Schema.String }) {}

/** Load an account so the Worker can check a password. Not on the public Api. */
export class LookupLogin extends Domain.Command("LookupLogin", {
  target: DirectoryId,
  input: { email: Schema.String },
  events: [LoginLookedUp],
  rejects: [BadCredentials],
  reply: {
    accountId: AccountId,
    name: Schema.String,
    email: Schema.String,
    role: Schema.Literals(["owner", "member"]),
    passwordHash: Schema.String,
  },
}) {}

/** Check a password hash and return the account. The password is not recorded. */
export class Authenticate extends Domain.Command("Authenticate", {
  target: DirectoryId,
  input: { email: Schema.String, passwordHash: Schema.String },
  events: [AccountAuthenticated],
  rejects: [BadCredentials],
  reply: {
    accountId: AccountId,
    name: Schema.String,
    email: Schema.String,
    role: Schema.Literals(["owner", "member"]),
  },
}) {}

/** Remember a board so people can list the ones on this team. */
export class NoteBoard extends Domain.Command("NoteBoard", {
  target: DirectoryId,
  input: { boardId: BoardId, title: Schema.String, ownerId: AccountId },
  events: [BoardNoted],
  rejects: [],
}) {}

export class BoardsListed extends Domain.Event("BoardsListed", {}) {}

/** Boards on this team. */
export class ReadBoards extends Domain.Command("ReadBoards", {
  target: DirectoryId,
  middleware: [Session],
  input: {},
  events: [BoardsListed],
  rejects: [],
  reply: {
    boards: Schema.Array(
      Schema.Struct({ boardId: BoardId, title: Schema.String, ownerId: AccountId }),
    ),
  },
}) {}

/** Who the caller is. Agents and humans both use it. */
export class WhoAmI extends Domain.Command("WhoAmI", {
  target: DirectoryId,
  middleware: [Session],
  input: {},
  events: [IdentityRead],
  rejects: [],
  reply: {
    kind: Schema.Literals(["human", "agent"]),
    actorId: Schema.String,
    name: Schema.String,
    role: Schema.String,
    email: Schema.optional(Schema.String),
    profile: Schema.optional(Schema.String),
    boardId: Schema.optional(Schema.String),
  },
}) {}

const described = (actor: Actor) =>
  actor._tag === "Human"
    ? new IdentityRead({
        kind: "human",
        actorId: actor.accountId,
        name: actor.name,
        role: actor.role,
        email: actor.email,
        ...(actor.profile === undefined ? {} : { profile: actor.profile }),
      })
    : new IdentityRead({
        kind: "agent",
        actorId: actor.agentId,
        name: actor.name,
        role: "agent",
        boardId: actor.boardId,
        ...(actor.profile === undefined ? {} : { profile: actor.profile }),
      });

/**
 * The team: accounts, the boards they have opened, and who is calling.
 * Password hashes stay here and never appear on a board's feed.
 */
export class Directory extends Domain.Aggregate("Directory", {
  id: DirectoryId,
  state: State,
  initial: { accounts: {}, boards: {} },
  commands: [RegisterAccount, LookupLogin, Authenticate, NoteBoard, WhoAmI, ReadBoards],
  decide: {
    RegisterAccount: (state, cmd) =>
      Effect.gen(function* () {
        const email = emailOf(cmd.email);

        if (blank(cmd.name) || !email.includes("@")) return yield* new InvalidWork();

        if (cmd.passwordHash.length < 8) return yield* new WeakPassword();

        if (Object.values(state.accounts).some((account) => account.email === email)) {
          return yield* new AccountExists();
        }

        return [
          new AccountRegistered({
            accountId: cmd.accountId,
            name: cmd.name.trim(),
            email,
            passwordHash: cmd.passwordHash,
            role: Object.keys(state.accounts).length === 0 ? "owner" : "member",
          }),
        ];
      }),
    LookupLogin: (state, cmd) => {
      const email = emailOf(cmd.email);

      if (!Object.values(state.accounts).some((account) => account.email === email)) {
        return new BadCredentials();
      }

      return [new LoginLookedUp({ email })];
    },
    Authenticate: (state, cmd) =>
      Effect.gen(function* () {
        const email = emailOf(cmd.email);
        const account = Object.values(state.accounts).find((item) => item.email === email);

        if (account === undefined) return yield* new BadCredentials();
        const matches = sameSecret(cmd.passwordHash, account.passwordHash);

        if (!matches) return yield* new BadCredentials();

        return [
          new AccountAuthenticated({
            accountId: account.accountId,
            name: account.name,
            email: account.email,
            role: account.role,
          }),
        ];
      }),
    NoteBoard: (state, cmd) => {
      if (state.boards[cmd.boardId] !== undefined) return [];

      return [new BoardNoted({ boardId: cmd.boardId, title: cmd.title, ownerId: cmd.ownerId })];
    },
    ReadBoards: () => [new BoardsListed({})],
    WhoAmI: () =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;

        return [described(actor)];
      }),
  },
  evolve: {
    AccountRegistered: (state, event) => ({
      ...state,
      accounts: {
        ...state.accounts,
        [event.accountId]: {
          accountId: event.accountId,
          name: event.name,
          email: event.email,
          passwordHash: event.passwordHash,
          role: event.role,
        },
      },
    }),
    BoardNoted: (state, event) => ({
      ...state,
      boards: {
        ...state.boards,
        [event.boardId]: {
          boardId: event.boardId,
          title: event.title,
          ownerId: event.ownerId,
        },
      },
    }),
    IdentityRead: (state) => state,
    LoginLookedUp: (state) => state,
    BoardsListed: (state) => state,
    AccountAuthenticated: (state) => state,
  },
  reply: {
    RegisterAccount: (state, events) => {
      const registered = events.find((event) => event._tag === "AccountRegistered");

      if (registered === undefined || registered._tag !== "AccountRegistered") {
        const account = Object.values(state.accounts)[0];

        return {
          accountId: account?.accountId ?? AccountId.make("missing"),
          name: account?.name ?? "",
          email: account?.email ?? "",
          role: account?.role ?? "member",
        };
      }

      return {
        accountId: registered.accountId,
        name: registered.name,
        email: registered.email,
        role: registered.role,
      };
    },
    LookupLogin: (state, events) => {
      const found = events.find((event) => event._tag === "LoginLookedUp");
      const email = found !== undefined && found._tag === "LoginLookedUp" ? found.email : "";
      const account = Object.values(state.accounts).find((item) => item.email === email);

      return {
        accountId: account?.accountId ?? AccountId.make("missing"),
        name: account?.name ?? "",
        email: account?.email ?? "",
        role: account?.role ?? "member",
        passwordHash: account?.passwordHash ?? "",
      };
    },
    Authenticate: (_state, events) => {
      const found = events.find((event) => event._tag === "AccountAuthenticated");

      if (found === undefined || found._tag !== "AccountAuthenticated") {
        return {
          accountId: AccountId.make("missing"),
          name: "",
          email: "",
          role: "member" as const,
        };
      }

      return {
        accountId: found.accountId,
        name: found.name,
        email: found.email,
        role: found.role,
      };
    },
    ReadBoards: (state) => ({
      boards: Object.values(state.boards),
    }),
    WhoAmI: (_state, events) => {
      const read = events.find((event) => event._tag === "IdentityRead");

      if (read === undefined || read._tag !== "IdentityRead") {
        return { kind: "human" as const, actorId: "missing", name: "", role: "member" };
      }

      return {
        kind: read.kind,
        actorId: read.actorId,
        name: read.name,
        role: read.role,
        ...(read.email === undefined ? {} : { email: read.email }),
        ...(read.profile === undefined ? {} : { profile: read.profile }),
        ...(read.boardId === undefined ? {} : { boardId: read.boardId }),
      };
    },
  },
}) {}
