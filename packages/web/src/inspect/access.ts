// @ts-nocheck
export const PERMISSIONS = ["read", "post", "react", "label", "manage"] as const;

type Grant = { pattern: string; permissions: readonly string[] };

const matches = (pattern: string, channel: string) => {
  if (pattern === "*") return true;

  if (pattern.endsWith("/")) return channel.startsWith(pattern);

  return pattern === channel;
};

/** The most specific matching grant answers whether a permission holds. */
export const compileAccess = (grants: readonly Grant[]) => ({
  can(permission: string, channel: string) {
    const matched = grants.filter((grant) => matches(grant.pattern, channel));
    const chosen = matched.sort((left, right) => right.pattern.length - left.pattern.length)[0];

    return chosen?.permissions.includes(permission) ?? false;
  },
  at(permission: string, pattern: string) {
    return grants.some(
      (grant) => grant.pattern === pattern && grant.permissions.includes(permission),
    );
  },
});
