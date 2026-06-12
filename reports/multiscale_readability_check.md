# Multiscale Centerline Readability Check

Generated at: 2026-06-11T19:28:09.134Z

## Formal problem

Let f_i(t) be layer thickness, H(t)=sum_i f_i(t), b(t) be the baseline, and c(t)=b(t)+H(t)/2 be the stream centerline.
The SineStream-style baseline can create a concentrated centerline derivative d(t)=c(t)-c(t-1) near a burst.
The desired multiscale baseline is not a flat centerline. It is a bounded wave that spreads derivative mass across several scale bands:

J(b)=w_p max|d| + w_c concentration(|d|) + w_m topMass(|d|) + w_k mean|Delta d| + w_l layerSlope + w_r corridorViolation - w_s slopeCoverage.

Subject to thickness invariance, fixed layer order, and a center corridor |c(t)-median(c)| <= rho H(t) with soft penalty.
Lower J is better. For the current implementation, SineStream is the anchor and multiscale is accepted when peak derivative, derivative concentration, burst mass share, and the aggregate score improve without a large layer mean-slope regression.

## Metric meanings

- Centerline peak derivative: maximum |c(t)-c(t-1)|. Lower means the one-burst centerline is suppressed.
- Derivative concentration: max derivative divided by mean derivative. Lower means motion is less dominated by one moment.
- Top-5% derivative mass: derivative mass held by the largest 5% of steps. Lower means less burst concentration.
- Slope coverage: soft fraction of time steps with nontrivial centerline slope. Higher means the desired small wave is active more globally.
- Wiggle energy: sum of squared second differences of layer centerlines. Lower means less stream wiggle.
- Corridor violation: amount by which centerline amplitude exceeds 18% of local stream thickness. Lower keeps the wave bounded.

## Project data: Covid H1

- ERROR: TypeError: Cannot read properties of undefined (reading 'length')

## Simulated burst: asymmetric layer burst, TPID order, SineStream baseline -> multiscale baseline

- time points: 190
- layers: 9
- ordering notes: TPID scoring: alpha=0.80 | top PID-time layer: burst-3 score=0.360

Diagnostics:
- verifiedMultiscale: yes
- fallback: no
- energyThreshold: 0.0800
- selected/effective scales: 2/2
- active coefficients: 64:-0.10, 128:1.00
- top scale energy: 64:41.6%, 128:35.4%, 16:5.9%, 8:5.9%, 256:5.0%, 32:3.7%
- internal objective: 8.2000 -> 7.9293

### Main window

- ROI: [0, 189] (2022-01-01 to 2022-07-09)
- Status: PASS
- Notes: all core centerline checks passed

![Simulated burst: asymmetric layer burst, TPID order, SineStream baseline -> multiscale baseline Main window comparison](assets/multiscale-simulated-burst-asymmetric-layer-burst-tpid-order-sinestream-baseline-multiscale-baseline-main-window.svg)

| Metric | SineStream | Multiscale | Delta | Improvement | Better |
|---|---:|---:|---:|---:|---|
| Readability score | 4.8000 | 3.9715 | -0.8285 | +17.26% | down |
| Centerline peak derivative | 5.2140 | 3.1646 | -2.0494 | +39.31% | down |
| Derivative concentration | 7.2927 | 6.4592 | -0.8335 | +11.43% | down |
| Top-5% derivative mass | 0.3525 | 0.3158 | -0.0367 | +10.41% | down |
| Slope coverage | 0.6195 | 0.6735 | 0.0540 | +8.71% | up |
| Centerline curvature | 0.1275 | 0.0829 | -0.0446 | +34.96% | down |
| Wiggle energy | 394.0122 | 389.8389 | -4.1733 | +1.06% | down |
| Layer mean slope | 3.6116 | 3.5887 | -0.0230 | +0.64% | down |
| Layer max slope | 39.3850 | 38.2091 | -1.1760 | +2.99% | down |
| Layer curvature | 0.6288 | 0.6236 | -5.193e-3 | +0.83% | down |
| Corridor violation | 0.0000 | 0.0000 | 0.0000 | +0.00% | down |

### ROI

- ROI: [82, 126] (2022-03-24 to 2022-05-07)
- Status: PASS
- Notes: all core centerline checks passed

![Simulated burst: asymmetric layer burst, TPID order, SineStream baseline -> multiscale baseline ROI comparison](assets/multiscale-simulated-burst-asymmetric-layer-burst-tpid-order-sinestream-baseline-multiscale-baseline-roi.svg)

| Metric | SineStream | Multiscale | Delta | Improvement | Better |
|---|---:|---:|---:|---:|---|
| Readability score | 4.8000 | 4.0497 | -0.7503 | +15.63% | down |
| Centerline peak derivative | 5.2140 | 3.1646 | -2.0494 | +39.31% | down |
| Derivative concentration | 2.2033 | 2.1302 | -0.0731 | +3.32% | down |
| Top-5% derivative mass | 0.1481 | 0.1437 | -4.386e-3 | +2.96% | down |
| Slope coverage | 0.8872 | 0.9188 | 0.0316 | +3.56% | up |
| Centerline curvature | 0.4452 | 0.2698 | -0.1754 | +39.41% | down |
| Wiggle energy | 369.1624 | 365.1290 | -4.0334 | +1.09% | down |
| Layer mean slope | 11.2071 | 11.1109 | -0.0962 | +0.86% | down |
| Layer max slope | 39.3850 | 38.2091 | -1.1760 | +2.99% | down |
| Layer curvature | 2.0998 | 2.0803 | -0.0196 | +0.93% | down |
| Corridor violation | 0.0000 | 0.0000 | 0.0000 | +0.00% | down |
