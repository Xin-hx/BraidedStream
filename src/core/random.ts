/**
 * Small deterministic random helpers used by core ordering algorithms.
 */

/** Deterministically shuffle integer indices with a small seeded PRNG. */
export function seededShuffleIndices(count: number, seed: number): number[] {
  const out = Array.from({ length: count }, (_value, index) => index);
  const random = mulberry32(normalizeSeed(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    return 1;
  }
  return (Math.floor(seed) >>> 0) || 1;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

