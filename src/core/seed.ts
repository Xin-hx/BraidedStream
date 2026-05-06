/**
 * Shared deterministic seed constants used by layout and rendering code.
 */
export const FIXED_SEED = 40;

/** Prefix a caller-provided seed with the project fixed seed. */
export function withFixedSeed(seedLike: string, fixedSeed = FIXED_SEED): string {
  return `${fixedSeed}:${seedLike}`;
}
