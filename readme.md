# Uncertainty-Aware Streamgraph for Time-Series Ensembles

This project is an interactive Vue/D3 workbench for streamgraph ordering,
baseline optimization, PID/contour inspection, and spaghetti views over
time-series ensemble data.

The current pipeline is:

```text
dataset quantiles
  -> layer ordering
  -> baseline optimization
  -> stacked yTop/yBottom geometry
  -> metrics + interactive views
```

The old ROI gap experiment has been removed from the active code.

## Run

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
```

Useful report scripts:

```bash
npm run report:multiscale
npm run check:multiscale
npm run report:pid-vs-sine
npm run check:core-refactor
```

## Structure

```text
src/
  app/sceneBuilder.ts        dataset -> order -> baseline -> stack -> metrics
  core/baseline/             baseline solvers
  core/ordering/             layer ordering
  core/ranking/              PID-related ranking helpers
  core/stack.ts              baseline + layer thickness -> yBottom/yTop
  data/                      dataset loading and transforms
  layout/                    metrics and parameter search
  render/                    D3 chart classes
  views/                     Vue view components
  state/appState.ts          default app state and UI parameters
```

## Workbench

The main page contains:

- Global stream view with ROI and inset window selection.
- Optimizing detail view for the current ordering/baseline result.
- Compare drawer for current-vs-baseline layout checks.
- Spaghetti view for selected ensemble members.
- SVG, PNG, and JSON snapshot export.

Default state is configured in `src/state/appState.ts`.
