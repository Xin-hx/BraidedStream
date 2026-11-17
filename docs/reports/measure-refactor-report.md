> Historical report: paths and command output below describe the repository before the app/examples/scripts directory migration. Current locations are documented in the root README.

# Unified probability-measure refactor: corrected verification report

This report supersedes the earlier review-failing evidence. In particular, the lower generalized inverse is **not** implemented by subtracting a probability tolerance. It remains

`inf { x : F(x) >= p }`

at the requested probability. Exact half-sample behavior comes from compensated mass summation and deterministic coordinate order; near-half masses remain distinguishable.

## Blocking findings M1–M4

- **M1 — stable moments.** Variance is now accumulated from component centers around the computed mean, plus the analytic within-uniform variance. `{1e9,1e9+1}` at equal mass gives variance `0.25` and standard deviation `0.5`; `delta(1e200)` gives variance/bandwidth `0`. A genuinely unrepresentable derived variance such as `Uniform(0,1e308)` throws an explicit finite-representation error instead of returning `NaN`, infinity, or a fabricated zero.
- **M2 — exact lower inverse.** The `1e-14` probability relaxation was removed. Mass `0.499999999999995` at zero and the remainder at one has median `1`; reversing the near-half imbalance has median `0`. Ten equal atoms select the lower fifth atom. Input normalization and CDF accumulation use compensated sums so even sample counts do not drift across `0.5` merely because `n * (1/n)` is inexact.
- **M3 — density-scale canonicalization.** Adjacent uniforms are merged only within `16 * Number.EPSILON` relative to their actual density scale. The reviewed `0.9/1e15` versus `0.1/1e15` intervals remain separate and retain `F(1e15)=0.9`. Equivalent split-uniform assertions compare analytic results with numerical tolerances.
- **M4 — translated/narrow support.** KDE topology uses merged support-local windows expanded by eight bandwidths, with resolution tied to bandwidth and separate windows across large empty gaps. KDE CDF roots bracket on the same localized support breakpoints. TPID overlap integration splits at those window boundaries before Simpson integration, so a large translation does not make the narrow terminal region disappear. The reviewed equal atoms at `1000` and `1001`, beta `0.3`, now produce two modes near the atoms rather than one false mode at `1002.2`. Median, quartile, and self-overlap translation tests cover both the root and integration paths.

The dedicated test file was first run against the uncorrected production code: **5/5 tests failed**, one for each M1, M2, M3 and two M4 paths. After the fixes it passes 5/5 without loosening the mathematical expectations.

## Converter and consumer contract corrections C1–C5

The second targeted RED run used the real converters and the real `demo/main.ts` loading path (with rendering work mocked only at its boundary). It ran 11 focused tests: **5 failed** before the fixes and 6 existing converter tests passed. After the fixes the same run passed **11/11**.

- **C1 — blank illustration values.** Empty or whitespace-only `value` cells are rejected before numeric conversion, so they cannot become false zero atoms through `Number("")`.
- **C2 — strict TCM visit shape and chronology.** Missing/invalid dates and absent, null, array, or other non-object `categories` now fail with both the source CSV row and one-based visit index. Explicit `{}` remains a valid observed all-zero category map. Accepted dates are sorted by parsed timestamp; canonical ISO dates also reject normalized impossible calendar dates such as `2022-02-30`. The actual source was rechecked at 33 patient rows and 566 visits, with zero missing dates and zero missing categories.
- **C3 — arbitrary category IDs.** Visit category maps use a null prototype and derived metadata/PID records retain own entries for legitimate IDs including `__proto__`, `constructor`, and `toString`. User-ID lookups no longer inherit color overrides or `Object.prototype` values. This is an ID-preservation correction, not a claim of global prototype pollution.
- **C4 — latest-request-only loading.** Each dataset request captures its dataset ID and monotonic version, aborts the prior request, and checks the version before parsing, committing, running, or displaying an error. The controlled-fetch DOM regression starts TCM then illustration, resolves illustration first and the ignored-abort TCM last, and confirms the illustration cache/render remains current. Dataset change failures are handled and shown without an unhandled rejection.
- **C5 — tooltip text safety.** Tooltip titles, layer IDs, labels, and values are constructed as DOM nodes with `textContent`. The DOM regression uses a category named `<img src=x onerror="this.dataset.executed=1">`, confirms its literal text is present, and confirms no `img` node is created.

Within the same consumer boundary, `renderTimeFilter` now defaults to `result.layoutOrder` when no explicit order is supplied. If both TCM weight columns are present, `observation_weight` has documented/tested priority independent of column order.

## Real-case numerical behavior

Selected-cell raw summaries and mode counts remain:

| case/cell | raw mean | raw variance | median | A- | A+ | modes | corrected separations |
|---|---:|---:|---:|---:|---:|---:|---|
| TCM 凉血止血类 / visit 20 | 8.75 | 54.6875 | 15 | 6.25 | 0 | 2 | `8.760220834736659` |
| COVID Alabama / 2022-04-02 | 1183.3561912506088 | 616269.7088186606 | 1263.0685233734623 | 349.852363240094 | 270.1400311172404 | 3 | `335.34170418786874`, `0.8136618977964594` |
| Illustration A / 0.0 | 0.48058935456745944 | 0.000473659580339153 | 0.47064080235770067 | 0.003611301113038417 | 0.013559853322797452 | 4 | `0.000044293356660582745`, `0.002570530372767669`, `0.011657913296367324` |

The support-aware grid changes separation quadrature from the prior fixed-grid values: TCM `8.763164492781407 -> 8.760220834736659`; COVID `335.2921470813207, 0.8365028003157673 -> 335.34170418786874, 0.8136618977964594`; Illustration `0.00003074500996032344, 0.0025883283289445335, 0.011589328794138017 -> 0.000044293356660582745, 0.002570530372767669, 0.011657913296367324`. These are real numerical changes and are not described as byte-level roundoff-only equivalence.

The selected cells keep mode counts `2/3/4`. Current TPID rankings are:

- TCM: 凉血止血类, 止血药, 解表药, 安神药, 活血类, 安神类, 活血祛瘀药, 祛湿类, 理气药, 祛风湿类, 清热类, 收敛药, 止咳化痰类, 泄浊毒类, 补脾益气类, 补肾类, 补虚药, 平肝潜阳类, 祛风止痒类, 温阳类, 消食药, 泻下药, 凉血活血类, 利尿通淋类.
- COVID: Alabama, Kentucky, Tennessee, Mississippi.
- Illustration: A, C, B.

Regenerated figure evidence reports TCM visit 5/20 total branch counts `60/52` (central category `4/2`) and COVID 2022-02-19 counts Alabama `3`, Kentucky `3`, Mississippi `3`, Tennessee `2`. The former report's unsupported full-topology SHA claims were removed; permanent regression assertions cover selected real cells, current mode counts, ranking heads, conservation, and generated case evidence.

## Delivery and verification

`.gitignore` no longer hides `tests/`. It exposes permanent `output/*.ts`, `output/*.d.ts`, `output/tsconfig.json`, `output/covid-selection.json`, and this report, while generated SVG/PNG/CSV/story artifacts remain ignored. No temporary probe scripts remain.

- `npm test` — 7 files, **41 tests passed**.
- `npm run build` — TypeScript passed; Vite built 583 modules.
- `node_modules/.bin/tsc.cmd --project output/tsconfig.json --noEmit` — passed.
- `node_modules/.bin/vite-node.cmd output/generate-tcm.ts` — regenerated the TCM stream, four KDE panels, CCDF, visit samples, and story.
- `node_modules/.bin/vite-node.cmd output/generate-covid.ts` — regenerated the COVID main/detail figures, metrics, story, and selection.

Official COVID ensemble quantiles remain independent display/reference metadata and are not used as the reconstructed mixture summary.

## Parent-agent independent execution

After all implementation writers stopped, the coordinating agent independently ran `npm test` (7 files, 41 passing tests), `npm run build`, `./node_modules/.bin/tsc --project output/tsconfig.json --noEmit`, both real `vite-node` generators, and `git diff --check`; the combined command exited 0. The four original mathematical minimal repros were also independently rerun and now return the expected variance, lower median, preserved low-density CDF and two distant-support modes.

A separate headless Chromium session exercised the existing Vite server at `http://localhost:5173` without starting another dev server. All 9 distinct dataset/view combinations (Illustration, TCM, COVID × braided, star, color-blur) rendered layer paths, with zero runtime/log errors and zero `NaN`/`Infinity` path coordinates. The COVID screenshot showed a visible chart, legend and time filter without an error overlay. This browser smoke test does not establish perceptual effectiveness or exhaustive UI correctness.

## Final independent review

A fresh read-only reviewer inspected the unstaged diff, new input/engine/converter code, all permanent regression tests, real demo consumers and output generators against baseline `12e5354` and the finalized design. Verdict: **passed**, no unresolved security or logic blockers within this refactor contract. The reviewer independently executed the M1–M4 minimal repros in memory and confirmed the corrected variance/bandwidth, strict near-half median, preserved low-density CDF, distant modes and translated overlap; it also verified the converter validation, special-ID preservation, request-version isolation and text-only tooltip construction. No Git commit or push was performed.


