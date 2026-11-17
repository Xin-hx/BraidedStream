/**
 * COVID-only paper-example exporter.
 * Run from the repository root: npx vite-node scripts/figures/generate-covid.ts
 *
 * For visual tuning, edit the COVID constants, paperStyle, and
 * addCovidDistributions sections in generate-example-common.ts.
 */
import { generateCovidExample } from "./generate-example-common";

generateCovidExample();
