import { BetterAuth, type BetterAuthInstance } from "@alchemy.run/better-auth";
import * as Alchemy from "alchemy";
import { APIError } from "better-auth/api";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { bearer } from "better-auth/plugins";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

/** Agent credentials expire after a week and can be revoked before that. */
export const AGENT_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

const authOptions = {
  basePath: "/api/auth",
  emailAndPassword: { enabled: true, disableSignUp: true, autoSignIn: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    additionalFields: {
      kind: { type: "string" as const, required: false, input: false, defaultValue: "human" },
      boardId: { type: "string" as const, required: false, input: false },
      agentId: { type: "string" as const, required: false, input: false },
      agentName: { type: "string" as const, required: false, input: false },
      profile: { type: "string" as const, required: false, input: false },
    },
  },
  user: {
    additionalFields: {
      role: { type: "string" as const, required: false, input: false, defaultValue: "member" },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 30 },
      "/sign-up/email": { window: 60, max: 30 },
    },
  },
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax" as const,
    },
  },
  plugins: [bearer()],
};

export type BoardAuthService = BetterAuthInstance<typeof authOptions>;

export class BoardAuth extends Context.Service<BoardAuth, BoardAuthService>()("BoardAuth") {}

export type SignupAdmission = (input: {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly invite: string | undefined;
  readonly seed: boolean;
}) => Promise<string>;

let admit: SignupAdmission | undefined;

interface PendingAdmission {
  readonly seed: boolean;
  readonly invite: string | undefined;
}

let pending: PendingAdmission | undefined;

/** The Worker binds this once it can record the account on the team directory. */
export const bindSignupAdmission = (next: SignupAdmission) => {
  admit = next;
};

const withAdmission = async <A>(next: PendingAdmission, body: () => Promise<A>) => {
  const previous = pending;
  pending = next;

  try {
    return await body();
  } finally {
    pending = previous;
  }
};

const boardAuth = (secret: string) =>
  BetterAuth({
    ...authOptions,
    secret,
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            if (admit === undefined) {
              throw new APIError("INTERNAL_SERVER_ERROR", { message: "Signup is not ready" });
            }

            const userId =
              typeof user.id === "string" && user.id.length > 0 ? user.id : crypto.randomUUID();
            const headers = (context as { readonly headers?: Headers } | null)?.headers;
            const header = headers?.get("x-board-invite");
            const invite =
              pending?.invite ??
              (header === undefined || header === null || header === "" ? undefined : header);

            if (pending?.seed !== true && invite === undefined) {
              throw new APIError("FORBIDDEN", { message: "Sign up is disabled" });
            }

            try {
              const role = await admit({
                userId,
                name: user.name,
                email: user.email,
                invite,
                seed: pending?.seed === true,
              });

              return { data: { ...user, id: userId, role } };
            } catch (cause) {
              if (
                pending?.seed === true &&
                cause instanceof Error &&
                cause.message === "AccountExists"
              ) {
                return { data: { ...user, id: userId, role: "owner" } };
              }

              const message = cause instanceof Error ? cause.message : "Invite required";

              throw new APIError("FORBIDDEN", { message });
            }
          },
        },
      },
    },
  });

/** The signing secret is Alchemy.Random, stable in stage state. */
export const AuthLive = Layer.unwrap(
  Effect.gen(function* () {
    const signing = yield* Alchemy.Random("better-auth-secret", { bytes: 32 });
    const read = yield* signing.text;
    const revealed =
      read !== undefined && Redacted.isRedacted(read) ? Redacted.value(read) : undefined;
    const secret =
      typeof read === "string"
        ? read
        : typeof revealed === "string"
          ? revealed
          : "board-auth-secret-dev-only-32chars-ok";
    const auth = yield* boardAuth(secret);

    return Layer.succeed(BoardAuth, auth as unknown as BoardAuthService);
  }),
);

interface CredentialContext {
  readonly password: { readonly hash: (password: string) => Promise<string> };
  readonly internalAdapter: {
    readonly findUserByEmail: (
      email: string,
      options?: { readonly includeAccounts?: boolean },
    ) => Promise<{
      readonly user: { readonly id: string; readonly email: string; readonly name: string };
      readonly accounts: ReadonlyArray<{
        readonly id: string;
        readonly providerId: string;
        readonly password?: string | null;
      }>;
    } | null>;
    readonly createUser: (user: Record<string, unknown>) => Promise<{ readonly id: string }>;
    readonly updateUser: (userId: string, data: Record<string, unknown>) => Promise<unknown>;
    readonly linkAccount: (account: Record<string, unknown>) => Promise<unknown>;
    readonly updateAccount: (id: string, data: Record<string, unknown>) => Promise<unknown>;
    readonly createSession: (userId: string) => Promise<{ readonly token: string }>;
    readonly deleteSession: (token: string) => Promise<void>;
    readonly listSessions: (userId: string) => Promise<ReadonlyArray<{ readonly token: string }>>;
  };
}

const authContext = (auth: BoardAuthService) =>
  Effect.gen(function* () {
    const instance = yield* auth.auth;

    return yield* Effect.promise(() => instance.$context as unknown as Promise<CredentialContext>);
  });

const remember = (input: {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly seed: boolean;
  readonly invite: string | undefined;
}) => {
  if (admit === undefined) return Promise.reject(new Error("Signup is not ready"));

  return admit(input).catch((cause: unknown) => {
    if (cause instanceof Error && cause.message === "AccountExists") return "owner";

    throw cause;
  });
};

const accountsOf = (accounts: unknown) => {
  if (Array.isArray(accounts))
    return accounts as ReadonlyArray<{ id: string; providerId: string; password?: string | null }>;

  return accounts === undefined || accounts === null
    ? []
    : [accounts as { id: string; providerId: string; password?: string | null }];
};

/**
 * Insert-or-ignore the owner, then keep the stored hash when it already matches
 * the deploy parameter. A different password is hashed with better-auth and the
 * old sessions are dropped. Same rule as the platform admin credential.
 */
export const seedOwner = (
  auth: BoardAuthService,
  input: { readonly email: string; readonly name: string; readonly password: string },
) =>
  Effect.gen(function* () {
    const context = yield* authContext(auth);
    const email = input.email.trim().toLowerCase();
    const existing = yield* Effect.promise(() =>
      context.internalAdapter.findUserByEmail(email, { includeAccounts: true }),
    );

    if (existing !== null) {
      const credential = accountsOf(existing.accounts).find(
        (account) => account.providerId === "credential",
      );
      const current = credential?.password;
      const matches =
        current !== undefined && current !== null && current.length > 0
          ? yield* Effect.promise(() => verifyPassword({ hash: current, password: input.password }))
          : false;

      if (!matches) {
        const hash = yield* Effect.promise(() => hashPassword(input.password));

        if (credential === undefined) {
          yield* Effect.promise(() =>
            context.internalAdapter.linkAccount({
              userId: existing.user.id,
              providerId: "credential",
              accountId: existing.user.id,
              password: hash,
            }),
          );
        } else {
          yield* Effect.promise(() =>
            context.internalAdapter.updateAccount(credential.id, { password: hash }),
          );
        }

        const sessions = yield* Effect.promise(() =>
          context.internalAdapter.listSessions(existing.user.id).catch(() => []),
        );

        yield* Effect.promise(() =>
          Promise.all(
            sessions.map((session) => context.internalAdapter.deleteSession(session.token)),
          ),
        );
      }

      yield* Effect.promise(() =>
        context.internalAdapter.updateUser(existing.user.id, { role: "owner" }),
      );
      yield* Effect.promise(() =>
        remember({
          userId: existing.user.id,
          name: input.name,
          email,
          seed: true,
          invite: undefined,
        }),
      );

      return;
    }

    const hash = yield* Effect.promise(() => hashPassword(input.password));

    yield* Effect.promise(() =>
      withAdmission({ seed: true, invite: undefined }, async () => {
        const user = await context.internalAdapter.createUser({
          email,
          name: input.name,
          emailVerified: true,
          role: "owner",
        });

        await context.internalAdapter.linkAccount({
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: hash,
        });
      }),
    );
  });

/** An invited person. Public sign-up stays disabled. */
export const createInvitedAccount = (
  auth: BoardAuthService,
  input: {
    readonly name: string;
    readonly email: string;
    readonly password: string;
    readonly invite: string;
  },
) =>
  Effect.gen(function* () {
    const context = yield* authContext(auth);
    const email = input.email.trim().toLowerCase();
    const hash = yield* Effect.promise(() => context.password.hash(input.password));
    const user = yield* Effect.promise(() =>
      withAdmission({ seed: false, invite: input.invite }, () =>
        context.internalAdapter.createUser({
          email,
          name: input.name,
          emailVerified: true,
        }),
      ),
    );
    yield* Effect.promise(() =>
      context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: hash,
      }),
    );
    const session = yield* Effect.promise(() => context.internalAdapter.createSession(user.id));

    return {
      accountId: user.id,
      name: input.name,
      email,
      role: "member",
      token: session.token,
    };
  });
