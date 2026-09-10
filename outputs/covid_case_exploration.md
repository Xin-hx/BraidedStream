# COVID-19 Forecast Hub trained-ensemble case exploration

Recommended states:
Alabama, Kentucky, Mississippi, Tennessee

Recommended period:
2021-11-06 ~ 2022-03-05

Why:
- Automatic window score: 0.826 for 2022-03-19 ~ 2022-05-07 (8 weeks).
- Omicron score: 0.412 for 2021-11-06 ~ 2022-02-26 (17 weeks).
- The Omicron transition was retained through the first following week because persistent competing modes and reconvergence are both present.

Key visual events:
1. The largest trained median was 143,797 in Tennessee on 2022-01-15.
2. The widest normalized trained Q2.5-Q97.5 interval was 2.04 in Tennessee on 2022-02-19.
3. Alabama's low-to-high branch weights moved 15%/15%/70% -> 25%/27%/47% -> 45%/39%/15% from 2022-02-12 to 2022-02-26 (total transferred support 54.5%).

Main case-study conclusion:
The selected period contains 3 persistent multi-mode state-weeks: forecast uncertainty was not only a broad coherent envelope; it also arose from competing component-forecast modes carrying different fractions of official trained-ensemble support.

## Automatic best window vs Omicron window

| Window | Period | Weeks | Score | Persistent multi-mode share | Mean disagreement | Mean uncertainty |
|---|---|---:|---:|---:|---:|---:|
| Automatic best | 2022-03-19 ~ 2022-05-07 | 8 | 0.826 | 9.4% | 0.620 | 2.122 |
| Omicron | 2021-11-06 ~ 2022-02-26 | 17 | 0.412 | 4.4% | 0.174 | 1.039 |
| Omicron + reconvergence | 2021-11-06 ~ 2022-03-05 | 18 | 0.511 | 4.2% | 0.187 | 1.074 |

## A. Overall magnitude

Tennessee contributed the largest cumulative trained median (749,714) in the selected four-state window. The single-week peak was 143,797 in Tennessee on 2022-01-15.

State peaks:
- Alabama: 122,432 on 2022-02-05
- Kentucky: 81,462 on 2022-01-29
- Mississippi: 75,500 on 2022-01-15
- Tennessee: 143,797 on 2022-01-15

## B. Predictive uncertainty

The largest normalized trained envelope was 2.036 in Tennessee on 2022-02-19. The largest normalized between-model disagreement was 0.903 in Tennessee on 2022-02-19. These are distinct quantities: the first is the trained ensemble's submitted Q2.5-Q97.5 width; the second is the weighted dispersion of active component Q50 values.

## C. Forecast disagreement

- Alabama: K=3 from 2022-02-12 to 2022-02-26 (3 consecutive weeks); initial centers 19171, 33031, 75767 with weights 15%/15%/70%.

## D. Branch support migration

Alabama's low-to-high branch weights moved 15%/15%/70% -> 25%/27%/47% -> 45%/39%/15% from 2022-02-12 to 2022-02-26 (total transferred support 54.5%). Branch weights are sums of normalized available official trained-ensemble performance weights, not model counts or outcome probabilities.

## E. Reconvergence

Persistent K>1 to K=1 transitions: Alabama on 2022-03-05.

## F. Actual outcome

Among 3 persistent multi-mode state-weeks with observations, the dominant branch was retrospectively closest to observed weekly incidence in 0 weeks (0.0%). This is a distance comparison, not a probability statement.

## Data coverage

- Dataset: 2021-07-31 ~ 2023-01-28, 51 states/DC, 4029 state-week records.
- Actual coverage: 100.0%.
- Available official trained weight retained: median 92.6%, minimum 55.4%.
