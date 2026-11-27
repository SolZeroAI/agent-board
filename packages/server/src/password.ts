const ITERATIONS = 10_000;

const text = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const bytes = (value: string) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index++) out[index] = raw.charCodeAt(index);

  return out;
};

/** PBKDF2 hash embedded with its salt, so a later check can repeat it. */
export const hashPassword = async (
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(16)),
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    key,
    256,
  );

  return `pbkdf2$${ITERATIONS}$${text(salt)}$${text(new Uint8Array(bits))}`;
};

/** True when the password matches a stored hash. */
export const passwordMatches = async (password: string, hash: string) => {
  const [kind, rounds, salt, digest] = hash.split("$");

  if (kind !== "pbkdf2" || rounds === undefined || salt === undefined || digest === undefined) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: bytes(salt), iterations: Number(rounds) },
    key,
    256,
  );
  const actual = text(new Uint8Array(bits));

  if (actual.length !== digest.length) return false;
  let mismatch = 0;

  for (let index = 0; index < actual.length; index++) {
    mismatch |= actual.charCodeAt(index) ^ digest.charCodeAt(index);
  }

  return mismatch === 0;
};
