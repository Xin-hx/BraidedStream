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

The representative thickness and directional deformation budget come from the
original measure `P`; KDE analysis of `P_hat` supplies only branch structure:

```text
m      = median(P)
H      = m
A-     = E_P[(m-X)+]
A+     = E_P[(X-m)+]
U  = A- + A+
b  = (A+ - A-) / U       (0 when U=0)
```

The deformation budget is `D=U`; the demo uses one layout unit per data unit.
There is no Q90 capacity, uncertainty rank, activation threshold, or
channel-specific gain.

## Probability inclusion order

TPID consumes the same analysis objects as braiding. For the common observed
reference times, each layer defines the temporal probability mask

```text
u_i(t,x) = P_hat_it(X > x),  x >= 0
```

on the joint time-value domain. The implementation follows the official PID
definition: `u_i subset_p u_j` is directional because it is normalized by the
mass of `u_i`; `IN-in` and `IN-out` are averaged separately over all `N`
layers, including the official self term; `TPID=min(IN-in,IN-out)`. There is no
pairwise symmetrization. A stable center-out mapping assigns higher TPID ranks
to more interior ordinal slots. This does not guarantee smaller pixel distance
to the chart midline or better geometric smoothness.

The time-value numerator is the weighted sum of `E[min(X_it,X_jt)]`, while the
source denominator is the weighted sum of `E[X_it]`. Equal observation-time
weights are used. Missing cells restrict the common reference set; a real
point mass at zero remains observed and follows PID's zero-mask convention.
TPID and branch extraction use the same KDE ratio `beta`, reflected boundary
treatment, and degenerate-distribution rules. Representative and envelope
statistics are computed from `P` before this KDE step.

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

The single allocation vector is `[A-, d_1, ..., d_(K-1), A+]`, where `A-` and
`A+` come from `P` and each `d_k` comes from the KDE. It is normalized once
into gaps whose sum is exactly the raw-measure budget `D`. Placement is cumulative in the order

```text
lower gap, branch 1, internal gap 1, ..., branch K, upper gap
```

This construction fills a slot of height `H+D` directly and therefore needs no
collision or repacking pass. Across time, branch and internal-gap arrays are
aligned by centered contiguous internal-gap matching. If two centered offsets
are possible, squared envelope-relative gap-center distance chooses one;
numerical ties choose the lower offset. Exterior gaps retain their side.
Unmatched gaps close inside a band, whose invisible subdivisions inherit the
other endpoint's relative branch thicknesses (equal shares for a zero total).
Statistical branch counts remain unchanged. Each interval has its own path.
Smooth rendering uses the monotone weight `3s²-2s³` on the aligned thicknesses,
then reconstructs every cumulative boundary. Turning smoothing off uses linear
interpolation of the same primitives. Both modes pass through observed values,
preserve non-negativity and envelope packing, and break paths at missing
cells.

## Rendering semantics

The envelope is not an interval estimate; its neutral outer stroke is an
optional, default-off rendering aid. Solid
branches use the category color; allocated gaps use a lighter tint of the same
hue. The tint establishes category ownership, but does not encode probability
mass or an additional uncertainty statistic. The vertical coordinate is a
layout coordinate, so the braided view hides absolute vertical tick labels and
shows a shared thickness ruler plus a high-value orientation cue. TCM uses
ordinal visit positions; ISO COVID target dates use their actual temporal
spacing. The complete envelope is an interaction target, while internal-gap
targets retain their lower, internal, or upper semantic label.

The demo also provides an optional, default-off KDE density color layer for
exploration outside the core braiding encoding. It samples density at equal
probability bins, uses one color scale per layer shared across all times, and
clips the resulting strips to the representative branches. It changes no
geometry, ordering, deformation budget, or cost. The strip count is the
`DENSITY_GRADIENT_BINS` constant in `demo/main.ts`. Density colors are opaque
and span a light-to-dark range. Four independent, default-off rendering aids
can show the envelope outline, representative-layer bounds, time-cell vertical
lines, and individual branch bounds. These strokes draw only their upper and
lower curves, never cell-edge vertical segments. When branches are collapsed,
only the envelope and representative-layer stroke controls remain available.

Run `npm test` to check PID directionality and analytic point-mass values as
well as mass conservation, budget conservation, asymmetry shift, mixture
reconstruction, degenerate cells, and positive unit scaling.
