export const FIXED_SEED = 40;
export function withFixedSeed(seedLike, fixedSeed = FIXED_SEED) {
    return `${fixedSeed}:${seedLike}`;
}
