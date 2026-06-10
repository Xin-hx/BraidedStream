# 0611 SineStream Multi-scale Baseline Verification

Generated at: 2026-06-10T17:33:51.104Z

Overall status: **FAIL**

## Method

- Goal: compare only baseline behavior while holding the layer set and layer order fixed.
- Controls: SineStream baseline, weighted wiggle L1 baseline, weighted wiggle L2 baseline.
- Experiment: current multi_scale baseline (`computeMultiscaleDistributedBaseline`).
- Ordering: fixed source layer order for all methods; this report does not claim TPID ordering contribution.
- Multi-scale parameters are selected from a deterministic grid over strength and Haar energy threshold.
- PASS requires multi_scale to improve every core metric against every control in Global and selected peak-change windows.
- Guardrail: layer mean slope, layer max slope, layer curvature, and wiggle energy may not regress by more than 3%.

## Source Check

- PDF path: found (E:\Project\2026Journal\Bu 等 - 2021 - SineStream Improving the Readability of Streamgraphs by Minimizing Sine Illusion Effects.pdf)
- PDF text extraction: ok
- Paper datasets detected: COVID, Bank Interest, Call, Assistance, Agriculture, Population, Disease
- SineStream source data directory: found (E:\Project\2026Journal\Demo\SineStream\data)
- Fallback to Data/sine_demo.json: no

## Source notes

- Using source data first; project fallback also exists at Data\sine_demo.json.

## Acceptance Metrics

| Group | Metrics | Rule |
|---|---|---|
| Core | Paper Eq.(5) illusion, Readability score, Centerline max derivative, Derivative concentration, Top derivative mass share | improvement must be > 0% |
| Guardrail | Layer mean slope, Layer max slope, Layer curvature, Wiggle energy | regression must be >= -3% |

## Case: COVID countries demo

- Source: E:\Project\2026Journal\Demo\SineStream\data\demo.json
- Time points: 44
- Layers: 10
- Order policy: fixed source layer order for all baselines
- Selected params: center=median, strength=0.2000, threshold=0.2000
- Search: total=198, pass=0, fail=198
- Selected status: FAIL
- Diagnostics: verified=yes, fallback=no, effectiveScales=2
- Fixed order: Germany, Spain, Turkey, Italy, Netherlands, Iran, US, Belgium, United Kingdom, France

Selected failure reasons:
- Global vs SineStream: Paper Eq.(5) illusion did not improve (-3.25%)
- Global vs SineStream: Top derivative mass share did not improve (-1.14%)
- Global vs Wiggle L1: Readability score did not improve (-9.37%)
- Global vs Wiggle L1: Centerline max derivative did not improve (-24.21%)
- Global vs Wiggle L1: Derivative concentration did not improve (-0.41%)
- Global vs Wiggle L1: Top derivative mass share did not improve (-3.37%)
- Global vs Wiggle L1: Layer max slope regressed -18.15%
- Global vs Wiggle L1: Wiggle energy regressed -4.93%
- Global vs Wiggle L2: Readability score did not improve (-21.32%)
- Global vs Wiggle L2: Centerline max derivative did not improve (-48.30%)
- Global vs Wiggle L2: Layer max slope regressed -38.86%
- Peak-change window 1 vs SineStream: Paper Eq.(5) illusion did not improve (-9.10%)
- Peak-change window 1 vs Wiggle L1: Readability score did not improve (-7.25%)
- Peak-change window 1 vs Wiggle L1: Centerline max derivative did not improve (-24.21%)
- Peak-change window 1 vs Wiggle L1: Layer max slope regressed -18.15%
- Peak-change window 1 vs Wiggle L2: Readability score did not improve (-19.31%)
- Peak-change window 1 vs Wiggle L2: Centerline max derivative did not improve (-48.30%)
- Peak-change window 1 vs Wiggle L2: Derivative concentration did not improve (-1.74%)
- ... 17 more

### Global

- Window: t0..t43
- Figure: [assets/covid-countries-demo-global.svg](assets/covid-countries-demo-global.svg)

![COVID countries demo Global](assets/covid-countries-demo-global.svg)

| Control | Status | Metric | Control | Multi-scale | Delta | Improvement |
|---|---|---|---:|---:|---:|---:|
| SineStream | FAIL | Paper Eq.(5) illusion | 3.5131e+9 | 3.6272e+9 | 1.1409e+8 | -3.25% |
| SineStream | PASS | Readability score | 4.8153 | 4.6751 | -0.1402 | +2.91% |
| SineStream | PASS | Centerline max derivative | 11655.40 | 10765.46 | -889.9457 | +7.64% |
| SineStream | PASS | Derivative concentration | 7.3272 | 7.2951 | -0.0321 | +0.44% |
| SineStream | FAIL | Top derivative mass share | 0.4070 | 0.4117 | 0.0047 | -1.14% |
| SineStream | PASS | Layer mean slope | 1003.35 | 1013.97 | 10.6108 | -1.06% |
| SineStream | PASS | Layer max slope | 14552.90 | 13662.96 | -889.9457 | +6.12% |
| SineStream | PASS | Layer curvature | 1596.39 | 1613.16 | 16.7663 | -1.05% |
| SineStream | PASS | Wiggle energy | 3.7432e+8 | 3.4056e+8 | -3.3762e+7 | +9.02% |
| Wiggle L1 | PASS | Paper Eq.(5) illusion | 5.5609e+9 | 3.6272e+9 | -1.9338e+9 | +34.77% |
| Wiggle L1 | FAIL | Readability score | 4.8006 | 5.2502 | 0.4496 | -9.37% |
| Wiggle L1 | FAIL | Centerline max derivative | 8666.85 | 10765.46 | 2098.60 | -24.21% |
| Wiggle L1 | FAIL | Derivative concentration | 7.2654 | 7.2951 | 0.0297 | -0.41% |
| Wiggle L1 | FAIL | Top derivative mass share | 0.3982 | 0.4117 | 0.0134 | -3.37% |
| Wiggle L1 | PASS | Layer mean slope | 1074.17 | 1013.97 | -60.2013 | +5.60% |
| Wiggle L1 | FAIL | Layer max slope | 11564.35 | 13662.96 | 2098.60 | -18.15% |
| Wiggle L1 | PASS | Layer curvature | 1711.65 | 1613.16 | -98.4907 | +5.75% |
| Wiggle L1 | FAIL | Wiggle energy | 3.2457e+8 | 3.4056e+8 | 1.5987e+7 | -4.93% |
| Wiggle L2 | PASS | Paper Eq.(5) illusion | 8.0067e+9 | 3.6272e+9 | -4.3796e+9 | +54.70% |
| Wiggle L2 | FAIL | Readability score | 4.8000 | 5.8236 | 1.0236 | -21.32% |
| Wiggle L2 | FAIL | Centerline max derivative | 7259.44 | 10765.46 | 3506.01 | -48.30% |
| Wiggle L2 | PASS | Derivative concentration | 8.1775 | 7.2951 | -0.8823 | +10.79% |
| Wiggle L2 | PASS | Top derivative mass share | 0.4360 | 0.4117 | -0.0243 | +5.57% |
| Wiggle L2 | PASS | Layer mean slope | 1180.48 | 1013.97 | -166.5142 | +14.11% |
| Wiggle L2 | FAIL | Layer max slope | 9839.20 | 13662.96 | 3823.75 | -38.86% |
| Wiggle L2 | PASS | Layer curvature | 1885.06 | 1613.16 | -271.9022 | +14.42% |
| Wiggle L2 | PASS | Wiggle energy | 3.3951e+8 | 3.4056e+8 | 1.0478e+6 | -0.31% |

### Peak-change window 1

- Window: t30..t40
- Peak change index: t35, delta=28516.00
- Figure: [assets/covid-countries-demo-peak-1.svg](assets/covid-countries-demo-peak-1.svg)

![COVID countries demo Peak-change window 1](assets/covid-countries-demo-peak-1.svg)

| Control | Status | Metric | Control | Multi-scale | Delta | Improvement |
|---|---|---|---:|---:|---:|---:|
| SineStream | FAIL | Paper Eq.(5) illusion | 4.4068e+9 | 4.8079e+9 | 4.0109e+8 | -9.10% |
| SineStream | PASS | Readability score | 4.8000 | 4.6439 | -0.1561 | +3.25% |
| SineStream | PASS | Centerline max derivative | 11655.40 | 10765.46 | -889.9457 | +7.64% |
| SineStream | PASS | Derivative concentration | 3.0004 | 2.9379 | -0.0625 | +2.08% |
| SineStream | PASS | Top derivative mass share | 0.3000 | 0.2938 | -0.0062 | +2.08% |
| SineStream | PASS | Layer mean slope | 1284.79 | 1305.78 | 20.9895 | -1.63% |
| SineStream | PASS | Layer max slope | 14552.90 | 13662.96 | -889.9457 | +6.12% |
| SineStream | PASS | Layer curvature | 2131.02 | 2159.02 | 27.9965 | -1.31% |
| SineStream | PASS | Wiggle energy | 1.4082e+8 | 1.2749e+8 | -1.3330e+7 | +9.47% |
| Wiggle L1 | PASS | Paper Eq.(5) illusion | 1.1273e+10 | 4.8079e+9 | -6.4655e+9 | +57.35% |
| Wiggle L1 | FAIL | Readability score | 4.8000 | 5.1481 | 0.3481 | -7.25% |
| Wiggle L1 | FAIL | Centerline max derivative | 8666.85 | 10765.46 | 2098.60 | -24.21% |
| Wiggle L1 | PASS | Derivative concentration | 2.9539 | 2.9379 | -0.0160 | +0.54% |
| Wiggle L1 | PASS | Top derivative mass share | 0.2954 | 0.2938 | -0.0016 | +0.54% |
| Wiggle L1 | PASS | Layer mean slope | 1584.93 | 1305.78 | -279.1580 | +17.61% |
| Wiggle L1 | FAIL | Layer max slope | 11564.35 | 13662.96 | 2098.60 | -18.15% |
| Wiggle L1 | PASS | Layer curvature | 2644.85 | 2159.02 | -485.8286 | +18.37% |
| Wiggle L1 | PASS | Wiggle energy | 1.3381e+8 | 1.2749e+8 | -6.3168e+6 | +4.72% |
| Wiggle L2 | PASS | Paper Eq.(5) illusion | 1.7944e+10 | 4.8079e+9 | -1.3136e+10 | +73.21% |
| Wiggle L2 | FAIL | Readability score | 4.8000 | 5.7268 | 0.9268 | -19.31% |
| Wiggle L2 | FAIL | Centerline max derivative | 7259.44 | 10765.46 | 3506.01 | -48.30% |
| Wiggle L2 | FAIL | Derivative concentration | 2.8877 | 2.9379 | 0.0502 | -1.74% |
| Wiggle L2 | FAIL | Top derivative mass share | 0.2888 | 0.2938 | 0.0050 | -1.74% |
| Wiggle L2 | PASS | Layer mean slope | 1820.25 | 1305.78 | -514.4784 | +28.26% |
| Wiggle L2 | FAIL | Layer max slope | 9839.20 | 13662.96 | 3823.75 | -38.86% |
| Wiggle L2 | PASS | Layer curvature | 3012.84 | 2159.02 | -853.8228 | +28.34% |
| Wiggle L2 | PASS | Wiggle energy | 1.5729e+8 | 1.2749e+8 | -2.9799e+7 | +18.95% |

### Peak-change window 2

- Window: t7..t17
- Peak change index: t12, delta=12211.00
- Figure: [assets/covid-countries-demo-peak-2.svg](assets/covid-countries-demo-peak-2.svg)

![COVID countries demo Peak-change window 2](assets/covid-countries-demo-peak-2.svg)

| Control | Status | Metric | Control | Multi-scale | Delta | Improvement |
|---|---|---|---:|---:|---:|---:|
| SineStream | FAIL | Paper Eq.(5) illusion | 5.4074e+7 | 1.3977e+8 | 8.5692e+7 | -158.47% |
| SineStream | PASS | Readability score | 4.9155 | 4.1884 | -0.7271 | +14.79% |
| SineStream | PASS | Centerline max derivative | 3986.25 | 2727.66 | -1258.58 | +31.57% |
| SineStream | PASS | Derivative concentration | 3.6631 | 3.2024 | -0.4607 | +12.58% |
| SineStream | PASS | Top derivative mass share | 0.3663 | 0.3202 | -0.0461 | +12.58% |
| SineStream | FAIL | Layer mean slope | 692.0022 | 720.4015 | 28.3993 | -4.10% |
| SineStream | PASS | Layer max slope | 9378.25 | 8119.66 | -1258.58 | +13.42% |
| SineStream | FAIL | Layer curvature | 1370.30 | 1441.74 | 71.4334 | -5.21% |
| SineStream | PASS | Wiggle energy | 7.8250e+7 | 6.0222e+7 | -1.8028e+7 | +23.04% |
| Wiggle L1 | PASS | Paper Eq.(5) illusion | 1.5256e+8 | 1.3977e+8 | -1.2795e+7 | +8.39% |
| Wiggle L1 | PASS | Readability score | 4.9005 | 4.7098 | -0.1907 | +3.89% |
| Wiggle L1 | PASS | Centerline max derivative | 2784.63 | 2727.66 | -56.9656 | +2.05% |
| Wiggle L1 | PASS | Derivative concentration | 3.5050 | 3.2024 | -0.3026 | +8.63% |
| Wiggle L1 | PASS | Top derivative mass share | 0.3505 | 0.3202 | -0.0303 | +8.63% |
| Wiggle L1 | PASS | Layer mean slope | 731.7511 | 720.4015 | -11.3496 | +1.55% |
| Wiggle L1 | PASS | Layer max slope | 8176.63 | 8119.66 | -56.9656 | +0.70% |
| Wiggle L1 | PASS | Layer curvature | 1478.39 | 1441.74 | -36.6592 | +2.48% |
| Wiggle L1 | PASS | Wiggle energy | 6.1374e+7 | 6.0222e+7 | -1.1517e+6 | +1.88% |
| Wiggle L2 | PASS | Paper Eq.(5) illusion | 4.9037e+8 | 1.3977e+8 | -3.5061e+8 | +71.50% |
| Wiggle L2 | FAIL | Readability score | 4.8093 | 7.1855 | 2.3762 | -49.41% |
| Wiggle L2 | FAIL | Centerline max derivative | 1211.52 | 2727.66 | 1516.15 | -125.14% |
| Wiggle L2 | FAIL | Derivative concentration | 2.6300 | 3.2024 | 0.5724 | -21.76% |
| Wiggle L2 | FAIL | Top derivative mass share | 0.2630 | 0.3202 | 0.0572 | -21.76% |
| Wiggle L2 | PASS | Layer mean slope | 810.7867 | 720.4015 | -90.3851 | +11.15% |
| Wiggle L2 | FAIL | Layer max slope | 6603.52 | 8119.66 | 1516.15 | -22.96% |
| Wiggle L2 | PASS | Layer curvature | 1642.90 | 1441.74 | -201.1621 | +12.24% |
| Wiggle L2 | FAIL | Wiggle energy | 5.6472e+7 | 6.0222e+7 | 3.7501e+6 | -6.64% |

### Peak-change window 3

- Window: t19..t29
- Peak change index: t24, delta=8757.00
- Figure: [assets/covid-countries-demo-peak-3.svg](assets/covid-countries-demo-peak-3.svg)

![COVID countries demo Peak-change window 3](assets/covid-countries-demo-peak-3.svg)

| Control | Status | Metric | Control | Multi-scale | Delta | Improvement |
|---|---|---|---:|---:|---:|---:|
| SineStream | FAIL | Paper Eq.(5) illusion | 6.4546e+9 | 6.4557e+9 | 1.0835e+6 | -0.02% |
| SineStream | PASS | Readability score | 4.8000 | 4.7883 | -0.0117 | +0.24% |
| SineStream | PASS | Centerline max derivative | 1575.48 | 1554.97 | -20.5119 | +1.30% |
| SineStream | FAIL | Derivative concentration | 2.3947 | 2.4109 | 0.0162 | -0.68% |
| SineStream | FAIL | Top derivative mass share | 0.2395 | 0.2411 | 0.0016 | -0.68% |
| SineStream | PASS | Layer mean slope | 1124.29 | 1126.56 | 2.2741 | -0.20% |
| SineStream | PASS | Layer max slope | 6075.48 | 6044.31 | -31.1673 | +0.51% |
| SineStream | PASS | Layer curvature | 1727.89 | 1733.75 | 5.8554 | -0.34% |
| SineStream | PASS | Wiggle energy | 4.4017e+7 | 4.3986e+7 | -31356.17 | +0.07% |
| Wiggle L1 | PASS | Paper Eq.(5) illusion | 7.0856e+9 | 6.4557e+9 | -6.2994e+8 | +8.89% |
| Wiggle L1 | PASS | Readability score | 4.8000 | 3.7771 | -1.0229 | +21.31% |
| Wiggle L1 | PASS | Centerline max derivative | 2139.81 | 1554.97 | -584.8421 | +27.33% |
| Wiggle L1 | PASS | Derivative concentration | 3.5480 | 2.4109 | -1.1371 | +32.05% |
| Wiggle L1 | PASS | Top derivative mass share | 0.3548 | 0.2411 | -0.1137 | +32.05% |
| Wiggle L1 | PASS | Layer mean slope | 1097.92 | 1126.56 | 28.6387 | -2.61% |
| Wiggle L1 | PASS | Layer max slope | 7263.81 | 6044.31 | -1219.50 | +16.79% |
| Wiggle L1 | PASS | Layer curvature | 1729.54 | 1733.75 | 4.2045 | -0.24% |
| Wiggle L1 | PASS | Wiggle energy | 4.5757e+7 | 4.3986e+7 | -1.7719e+6 | +3.87% |
| Wiggle L2 | PASS | Paper Eq.(5) illusion | 6.9457e+9 | 6.4557e+9 | -4.8998e+8 | +7.05% |
| Wiggle L2 | FAIL | Readability score | 4.8000 | 5.6131 | 0.8131 | -16.94% |
| Wiggle L2 | FAIL | Centerline max derivative | 988.1111 | 1554.97 | 566.8616 | -57.37% |
| Wiggle L2 | PASS | Derivative concentration | 2.5779 | 2.4109 | -0.1670 | +6.48% |
| Wiggle L2 | PASS | Top derivative mass share | 0.2578 | 0.2411 | -0.0167 | +6.48% |
| Wiggle L2 | PASS | Layer mean slope | 1142.72 | 1126.56 | -16.1605 | +1.41% |
| Wiggle L2 | FAIL | Layer max slope | 5779.81 | 6044.31 | 264.4967 | -4.58% |
| Wiggle L2 | PASS | Layer curvature | 1753.19 | 1733.75 | -19.4474 | +1.11% |
| Wiggle L2 | PASS | Wiggle energy | 4.3498e+7 | 4.3986e+7 | 487266.91 | -1.12% |
