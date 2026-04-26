export const FIXED_SEED = 40;

export function withFixedSeed(seedLike: string, fixedSeed = FIXED_SEED): string {
  return `${fixedSeed}:${seedLike}`;
}
