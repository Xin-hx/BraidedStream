# Distribution-aware Layer Geometry

The implementation follows `../visual_design.tex`. A category-time cell is one
probability distribution `P`, regardless of how its input is stored.

## Distribution adapters

- TCM cells are weighted empirical measures. Real zeros remain observations;
  non-finite missing visits are excluded; a cell with no valid observations is
  missing.
- COVID cells are weighted mixtures of reconstructed member quantile
  functions. Quantile knots are linearly interpolated in probability, with
  endpoint values held constant in the unreported tails. Official submitted
  ensemble quantiles remain reference metadata and never drive the braided
  geometry.

Both adapters are converted exactly to weighted point masses and uniform
segments. The COVID path is deterministic and does not pseudo-sample members.

## Shared analysis distribution

For every non-degenerate `P`, the code evaluates the reflected Gaussian KDE on
the original non-negative data scale. Its bandwidth is

```text
h = beta * standardDeviation(P)
```

`beta` is the only statistical resolution parameter and is shared by every
cell in a run. The default is `0.3`; the UI exposes it for sensitivity checks.
Grid size and quadrature steps are numerical accuracy settings, not filters or
statistical thresholds. A point mass is retained directly with `h=0`, `K=1`,
`pi=[1]`, and all dispersion and gap quantities equal to zero.

The analysis distribution supplies every visual quantity:

```text
m  = median
A- = E[(m-X)+]
A+ = E[(X-m)+]
U  = A- + A+
b  = (A+ - A-) / U       (0 when U=0)
```

Colored thickness is `H=m` and the deformation budget is `D=U`; the demo uses
one layout unit per data unit. There is no Q90 capacity, uncertainty rank,
activation threshold, or channel-specific gain.

## Modes, branches, and gaps

All KDE maxima at the declared `beta` are retained, including a one-sided
boundary mode at zero. Adjacent valley minima define modal basins. A branch has
thickness `H_k = H*pi_k`, where `pi_k` is its basin probability, so branch
thicknesses sum exactly to `H`. There is no maximum branch count, minimum mass,
valley-depth filter, or temporal persistence gate.

For adjacent peaks `c_k,c_(k+1)`, the implementation integrates

```text
d_k = integral[c_k,c_(k+1)] max(0, 1 - f(x)/min(f(c_k),f(c_(k+1)))) dx
```

The single allocation vector is `[A-, d_1, ..., d_(K-1), A+]`. It is normalized
once into gaps whose sum is exactly `D`. Placement is cumulative in the order

```text
lower gap, branch 1, internal gap 1, ..., branch K, upper gap
```

This construction fills a slot of height `H+D` directly and therefore needs no
collision or repacking pass. Across time, branch and internal-gap arrays are
aligned by low-to-high rank and zero-padded at the high end; the upper exterior
gap remains a separate path. For smooth rendering, the implementation applies a
shape-preserving cubic interpolation to non-negative branch and gap thicknesses,
then reconstructs every cumulative boundary. Turning smoothing off uses linear
interpolation of the same primitives. Both modes pass through observed values,
preserve the branch/gap budgets between observations, and break paths at missing
cells.

## Rendering semantics

The envelope has a neutral outline and is not an interval estimate. Solid
branches use the category color; allocated gaps use a lighter tint of the same
hue. The tint establishes category ownership, but does not encode probability
mass or an additional uncertainty statistic. The vertical coordinate is a
layout coordinate, so the braided view hides absolute vertical tick labels and
shows a shared thickness ruler plus a high-value orientation cue. TCM uses
ordinal visit positions; ISO COVID target dates use their actual temporal
spacing. The complete envelope is an interaction target, while internal-gap
targets retain their lower, internal, or upper semantic label.

Run `npm test` to check mass conservation, budget conservation, asymmetry shift,
mixture reconstruction, degenerate cells, and positive unit scaling.
