/**
 Global fixed seed = 40
 */
export const FIXED_SEED = 40;
/** Prefix a caller-provided seed with the project fixed seed. */
export function withFixedSeed(seedLike, fixedSeed = FIXED_SEED) {
    return `${fixedSeed}:${seedLike}`;
}
