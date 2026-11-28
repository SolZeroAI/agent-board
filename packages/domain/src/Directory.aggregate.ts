import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { Actor } from "./Actor.ts";
import { CurrentActor } from "./CurrentActor.ts";
import { AccountId, BoardId, DirectoryId } from "./ids.ts";
import { AccountExists, Forbidden, InvalidWork, InviteRequired } from "./rejections.ts";
import { Session } from "./Session.ts";
import { blank } from "./text.ts";

const Account = Schema.Struct({
  accountId: AccountId,
  name: Schema.String,
  email: Schema.String,
  role: Schema.Literals(["owner", "member"]),
});

const BoardRef = Schema.Struct({
  boardId: BoardId,
  title: Schema.String,
  ownerId: AccountId,
});

const Invite = Schema.Struct({
  code: Schema.String,
  used: Schema.Boolean,
});

const State = Schema.Struct({
  accounts: Schema.Record(Schema.String, Account),
  boards: Schema.Record(Schema.String, BoardRef),
  invites: Schema.optional(Schema.Record(Schema.String, Invite)),
});

type State = typeof State.Type;

export class AccountRegistered extends Domain.Event("AccountRegistered", {
  accountId: AccountId,
  name: Schema.String,
  email: Schema.String,
  role: Schema.Literals(["owner", "member"]),
}) {}

export class BoardNoted extends Domain.Event("BoardNoted", {
  boardId: BoardId,
  title: Schema.String,
  ownerId: AccountId,
}) {}

export class InviteCreated extends Domain.Event("InviteCreated", { code: Schema.String }) {}

export class InviteConsumed extends Domain.Event("InviteConsumed", { code: Schema.String }) {}

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

/**
 * The deploy seeds the owner. Later accounts need an invite from that owner.
 * Passwords live in better-auth, not here.
 */
export class RegisterAccount extends Domain.Command("RegisterAccount", {
  target: DirectoryId,
  input: {
    accountId: AccountId,
    name: Schema.String,
    email: Schema.String,
    invite: Schema.optional(Schema.String),
    seed: Schema.optional(Schema.Boolean),
  },
  events: [AccountRegistered, InviteConsumed],
  rejects: [AccountExists, InviteRequired, InvalidWork],
  reply: {
    accountId: AccountId,
    name: Schema.String,
    email: Schema.String,
    role: Schema.Literals(["owner", "member"]),
  },
}) {}

/** The team owner invites the next person. */
export class CreateInvite extends Domain.Command("CreateInvite", {
  target: DirectoryId,
  middleware: [Session],
  input: { code: Schema.String },
  events: [InviteCreated],
  rejects: [Forbidden, InvalidWork],
  reply: { code: Schema.String },
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

/** The team directory. Passwords live in better-auth, not here. */
export class Directory extends Domain.Aggregate("Directory", {
  id: DirectoryId,
  state: State,
  initial: { accounts: {}, boards: {}, invites: {} },
  commands: [RegisterAccount, CreateInvite, NoteBoard, WhoAmI, ReadBoards],
  decide: {
    RegisterAccount: (state, cmd) => {
      const email = emailOf(cmd.email);

      if (blank(cmd.name) || !email.includes("@")) return new InvalidWork();

      if (Object.values(state.accounts).some((account) => account.email === email)) {
        return new AccountExists();
      }

      const first = Object.keys(state.accounts).length === 0;

      if (cmd.seed === true || first) {
        return [
          new AccountRegistered({
            accountId: cmd.accountId,
            name: cmd.name.trim(),
            email,
            role: "owner",
          }),
        ];
      }

      const invites = state.invites ?? {};
      const invite = cmd.invite === undefined ? undefined : invites[cmd.invite];

      if (invite === undefined || invite.used) return new InviteRequired();

      return [
        new InviteConsumed({ code: invite.code }),
        new AccountRegistered({
          accountId: cmd.accountId,
          name: cmd.name.trim(),
          email,
          role: "member",
        }),
      ];
    },
    CreateInvite: Effect.fn(function* (state, cmd) {
      const actor = yield* CurrentActor;

      if (actor._tag !== "Human" || actor.role !== "owner")
        return yield* new Forbidden({ action: "manage" });

      if (blank(cmd.code)) return yield* new InvalidWork();

      return [new InviteCreated({ code: cmd.code.trim() })];
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
          role: event.role,
        },
      },
    }),
    InviteCreated: (state, event) => ({
      ...state,
      invites: { ...state.invites, [event.code]: { code: event.code, used: false } },
    }),
    InviteConsumed: (state, event) => ({
      ...state,
      invites: {
        ...state.invites,
        [event.code]: { code: event.code, used: true },
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
    BoardsListed: (state) => state,
  },
  reply: {
    RegisterAccount: (_state, events) => {
      const registered = events.find((event) => event._tag === "AccountRegistered");

      if (registered === undefined || registered._tag !== "AccountRegistered") {
        return {
          accountId: AccountId.make("missing"),
          name: "",
          email: "",
          role: "member" as const,
        };
      }

      return {
        accountId: registered.accountId,
        name: registered.name,
        email: registered.email,
        role: registered.role,
      };
    },
    CreateInvite: (_state, events) => ({
      code: events.find((event) => event._tag === "InviteCreated")?.code ?? "",
    }),
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
