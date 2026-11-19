# Package performance changes

The density-gradient feature has been removed from the app, pipeline output and SVG renderer. Layer colors remain configurable with `palette`, `colorOverrides` and `layers[].color`.

## Computation and scheduling

- `runPipeline(dataset, options)` remains the one-shot entry point. `preparePipeline(dataset).run(options)` owns a validated snapshot and caches raw statistics plus the latest bandwidth's KDE and TPID analysis. Baseline, ordering and debug changes only rebuild layout. Replacing the dataset requires a new prepared pipeline; returned results must be treated as immutable.
- Raw quantiles share a sorted sweep of atoms and interval endpoints: `O(C log C + Q log Q)` for C components and Q queries, rather than repeatedly scanning all components at each coordinate. Compensated accumulation preserves weighted jumps and plateaus. Extreme interval densities use direct CDF inversion to avoid floating-point overflow/underflow.
- TPID retains its original pair-specific Simpson nodes and triangular pair iteration. Survival evaluations at identical nodes are shared within each time point; caches are released before advancing to the next time. No approximate KDE or common-grid quadrature is introduced.
- Examples and custom datasets parse/analyze in browser Workers. Each analysis worker registers data once, then accepts options without cloning the dataset again. It retains at most one active request and the newest waiting request. Replaced requests reject with `AbortError`; dataset replacement and unmount terminate the worker. Bandwidth sliders commit on release.

## Rendering

The renderer retains keyed SVG marks and caches coordinates, interpolated geometry and path strings. Color and focus changes do not rewrite path data. Decoration toggles reuse geometry. Main-chart coordinates are shared with hit testing; unrelated options no longer redraw the overview.

Smoothing samples follow pixel spacing with a maximum of 32 subdivisions per interval. Observed points, missing boundaries and separate interval paths remain intact. Interpolation evaluates its known time interval directly, removing the previous repeated linear lookup. Streamgraph omits branch/gap arrays unless representative strokes need them. Pointer events coalesce per animation frame, nearest-time lookup uses binary search, and unchanged focus skips full-mark highlighting.

## Measurements

Local Windows / Node 24.22.1 comparison against the `ui-dev` branch before this change. Both implementations used the same normalized inputs, beta 0.3, debug enabled and density gradients disabled. Analysis figures are medians of three sequential runs per dataset, excluding file parsing; the new total includes snapshot preparation. These are diagnostic measurements, not cross-device latency guarantees.

| Dataset | Shape | Previous analysis | New analysis | Cached sine layout | Cached alphabetical layout |
| --- | --- | ---: | ---: | ---: | ---: |
| Illustration | 3 layers × 220 times, 27,720 components | 1,949 ms | 1,219 ms | 3.11 ms | 1.87 ms |
| COVID selection | 4 layers × 79 times, 20,841 components | 2,693 ms | 1,642 ms | 1.60 ms | 1.00 ms |
| Synthetic atoms | 1 layer × 135 times, 52,920 components | 4,207 ms | 469 ms | 0.68 ms | 0.57 ms |

Ranking and observed branch counts matched the previous implementation. Compared raw summaries and envelope coordinates differed by at most `5.83e-11` for COVID, and zero for the illustration and synthetic cases. Existing analytic, translated-support, near-half-mass and local real-data regressions remain part of the test suite.

Single jsdom SVG measurements, including path creation and DOM work but excluding browser layout/paint:

| Dataset | Previous initial SVG | New initial SVG | Previous color update | New color update |
| --- | ---: | ---: | ---: | ---: |
| Illustration | 282 ms | 45 ms | 269 ms | 3.8 ms |
| COVID selection | 266 ms | 56 ms | 218 ms | 3.7 ms |
| Synthetic atoms | 36 ms | 16 ms | 25 ms | 1.8 ms |

A production-build smoke test in headless Chrome exercised example loading, worker analysis, palette/node reuse, slider commit, hover, both visualization methods, COVID switching and a local synthetic CSV import. It reported approximately 1,461 ms for initial illustration parsing/analysis, 2.9 ms for a cached baseline layout, and 1,583 ms for COVID parsing/analysis. During a 1,083 ms bandwidth recomputation, a 20 ms main-thread timer fired 54 times and the Long Tasks observer recorded no task over 50 ms in that interval. Initial startup did contain two long tasks (68 and 63 ms). Worker timings exclude message transport and browser rendering.

No Canvas/FFT migration or approximate integration was needed. Large layer counts still incur pairwise TPID work, and SVG complexity still grows with visible data and branch count; browser frame-rate and memory scaling at extreme sizes have not been characterized.
