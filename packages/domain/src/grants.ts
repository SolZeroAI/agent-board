import type { Actor } from "./Actor.ts";

/** What a grant can allow in a channel. Sync is intentionally absent. */
export const PERMISSIONS = ["read", "post", "react", "label", "manage"] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type Principal =
  | { readonly _tag: "User"; readonly email: string }
  | { readonly _tag: "Agent"; readonly agentId: string }
  | { readonly _tag: "AllUsers" }
  | { readonly _tag: "AllAgents" }
  | { readonly _tag: "Everyone" };

export interface Grant {
  readonly grantId: string;
  readonly principals: ReadonlyArray<Principal>;
  readonly pattern: string;
  readonly permissions: ReadonlyArray<Permission>;
}

const rank = (principal: Principal) => {
  if (principal._tag === "User" || principal._tag === "Agent") return 2;

  if (principal._tag === "Everyone") return 0;

  return 1;
};

const names = (principal: Principal, actor: Actor) => {
  if (principal._tag === "Everyone") return true;

  if (principal._tag === "AllUsers") return actor._tag === "Human";

  if (principal._tag === "AllAgents") return actor._tag === "Agent";

  if (principal._tag === "User") return actor._tag === "Human" && actor.email === principal.email;

  return actor._tag === "Agent" && actor.agentId === principal.agentId;
};

/** How specific a pattern is. An exact channel beats a subtree, which beats `*`. */
export const specificity = (pattern: string) => {
  if (pattern === "*") return 0;

  if (pattern.endsWith("/")) return pattern.length;

  return 10_000 + pattern.length;
};

export const patternMatches = (pattern: string, channel: string) => {
  if (pattern === "*") return true;

  if (pattern.endsWith("/")) {
    const root = pattern.slice(0, -1);

    return channel === root || channel.startsWith(pattern);
  }

  return channel === pattern;
};

const union = (grants: ReadonlyArray<Grant>) => {
  const allowed = new Set<Permission>();

  for (const grant of grants) {
    for (const permission of grant.permissions) allowed.add(permission);
  }

  return allowed;
};

/**
 * The permissions `actor` has in `channel`. The most specific pattern wins,
 * then the closest principal, then tied grants add up. A token ceiling and
 * the team role can only remove permissions.
 */
export const permissionsFor = (
  grants: ReadonlyArray<Grant>,
  actor: Actor,
  channel: string,
): ReadonlySet<Permission> => {
  const matching = grants.filter(
    (grant) =>
      patternMatches(grant.pattern, channel) &&
      grant.principals.some((principal) => names(principal, actor)),
  );

  if (matching.length === 0) return new Set();
  const best = Math.max(...matching.map((grant) => specificity(grant.pattern)));
  const atPattern = matching.filter((grant) => specificity(grant.pattern) === best);
  const closest = Math.max(
    ...atPattern.map((grant) => Math.max(...grant.principals.map((principal) => rank(principal)))),
  );

  const tied = atPattern.filter((grant) =>
    grant.principals.some((principal) => names(principal, actor) && rank(principal) === closest),
  );

  const allowed = union(tied);

  if (actor.ceiling !== undefined) {
    const cap = new Set<Permission>();

    for (const entry of actor.ceiling) {
      if (!patternMatches(entry.pattern, channel)) continue;

      for (const permission of entry.permissions) {
        if (allowed.has(permission)) cap.add(permission);
      }
    }

    return cap;
  }

  return allowed;
};

export const can = (
  grants: ReadonlyArray<Grant>,
  actor: Actor,
  channel: string,
  permission: Permission,
) => permissionsFor(grants, actor, channel).has(permission);

/** A team owner may change grants even when a channel is closed to them. */
export const isTeamOwner = (actor: Actor) => actor._tag === "Human" && actor.role === "owner";
