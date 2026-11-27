/** Compare two hashes without short-circuiting on the first different character. */
export const sameSecret = (left: string, right: string) => {
  const width = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;

  for (let i = 0; i < width; i++) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }

  return mismatch === 0;
};
