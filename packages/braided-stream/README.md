# braided-stream

Framework-independent D3 streamgraphs for probability distributions. Includes the analysis pipeline, braided and streamgraph SVG renderers, hover events, and a time-range brush. Vue is used only by the repository application.

## Install

Build a tarball from this repository, then install it in your application:

```sh
npm install
npm pack --workspace braided-stream
# In the consuming project:
npm install /path/to/braided-stream-0.1.0.tgz d3@^7.9.0
```

Use an ESM-aware bundler and import `braided-stream/style.css` once. The package includes TypeScript declarations and D3 types. The DOM-free `braided-stream/core` entry also runs directly in Node.

## Input and rendering

```ts
import { select } from 'd3';
import { braidedStream, type InputDataset } from 'braided-stream';
import 'braided-stream/style.css';

const dataset: InputDataset = {
  times: ['t1', 't2'],
  layers: [{
    id: 'A',
    measures: [
      { components: [{ kind: 'atom', value: 2, mass: 1 }] },
      { components: [{ kind: 'uniform', low: 1, high: 5, mass: 1 }] },
    ],
  }],
};

const chart = braidedStream()
  .options({ width: 1180, height: 620, visMethod: 'braided' })
  .pipelineOptions({ baselineMode: 'wiggle' })
  .on('hover.app', ({ timeIndex, layerId, spaceKind, sourceEvent }) => {
    // Render your tooltip using text, and position it from sourceEvent.
    console.log(timeIndex, layerId, spaceKind, sourceEvent.clientX);
  })
  .on('leave.app', () => { /* hide tooltip */ });

const svg = document.querySelector<SVGSVGElement>('#chart')!;
select(svg).datum(dataset).call(chart);
```

Time labels must be unique; each layer has a unique nonempty ID and one measure per time. A measure is a mixture of atoms and/or uniform intervals with nonnegative mass; validation normalizes mass. `null` marks a missing observation. See the exported `InputDataset` and `ProbabilityMeasure` types for the full contract.

Date labels (`YYYY-MM-DD`) and `day N` labels use their actual spacing; other labels use their index. The chart uses a responsive SVG viewBox. Default size is 1180 × 620, with margins `{ top: 24, right: 28, bottom: 64, left: 64 }`.

## Reuse analysis and add a time filter

```ts
import { preparePipeline } from 'braided-stream/core';
import { streamTimeFilter } from 'braided-stream';

const pipeline = preparePipeline(dataset);
const result = pipeline.run({
  braided: { bandwidthRatio: 0.3, debug: true },
});
const prepared = { dataset, result };
const main = select(svg).datum(prepared);
main.call(chart);

const overview = streamTimeFilter().on('rangechange.app', ({ start, end }) => {
  main.call(chart.options({ start, end }));
});
const filterSvg = document.querySelector<SVGSVGElement>('#filter')!;
select(filterSvg).datum(prepared).call(overview);

// Reuses result; does not recompute analysis:
main.call(chart.options({ palette: 'set2', colorOverrides: { A: '#8dd3c7' } }));

// When removing the chart:
chart.destroy(main);
overview.destroy(select(filterSvg));
```

`start`/`end` are inclusive time indices, clamped to the dataset. The overview requires `{ dataset, result }`. Programmatic range updates do not emit `rangechange`. For raw datasets, analysis is cached per SVG until the bound datum reference or pipeline options change; replace the datum object after editing data. Precomputed results must correspond to the supplied dataset.

Options merge into the chart configuration. They include `width`, `height`, `margin`, `start`, `end`, `visMethod`, `layers` (`{ id, color? }[]`), `palette`, `colorOverrides`, `highlightLayer`, `smoothContours`, `showYAxis`, `showEnvelopeStroke`, `showRepresentativeStroke`, `showTimeCell`, `showBranchStroke`. Defaults match the application. Palette IDs: `reference`, `tableau10`, `set2`, `paired`.

Hover events are coalesced to animation frames in browsers. Hover events include `timeIndex`, nullable `layerId`, optional `spaceKind`, and `sourceEvent`. Chart interactions update only hover marks and highlighting. Listeners use D3 namespaces; pass `null` to remove a registered listener. `destroy` removes only the chart's nodes/listeners, preserving consumer-owned SVG children. A chart factory can be called on multiple SVGs; each SVG has independent analysis and interaction state.

## Repeated layouts

`preparePipeline(dataset)` validates and owns an independent snapshot. Its `.run(options)` reuses raw quantiles/moments/deviations and the latest KDE/TPID analysis. Changing baseline, order or debug output only rebuilds layout; changing bandwidth replaces the cached analysis. `runPipeline(dataset, options)` remains the one-shot API. Create a new prepared pipeline when the data changes. Treat returned results as immutable, including when passing them to a renderer.

```ts
const pipeline = preparePipeline(dataset);
const first = pipeline.run({ braided: { bandwidthRatio: 0.3 } });
const reordered = pipeline.run({ layoutOrder: ['B', 'A'], baselineMode: 'sine' });
```

Color configuration stays in chart options (`palette`, `colorOverrides`, or `layers[].color`), independently of analysis. Color/focus changes retain SVG nodes and path data. Smoothing samples follow displayed pixel spacing, capped at 32 subdivisions per interval; observed points, missing boundaries and separate interval segments remain intact. Streamgraph skips branch/gap interpolation unless representative strokes need those boundaries.

The application parses and analyzes examples and imports in Web Workers. It registers a dataset once per worker, sends only options for subsequent layouts, keeps the newest waiting request, and commits bandwidth sliders on release. Dataset replacement and unmount terminate pending work.

## Framework integration and lower-level APIs

In Vue, create factories once during setup, call them after mounting or changing chart inputs, and call `destroy` before unmounting. Vue owns the SVG host; D3 owns the nested chart SVG. Keep `PipelineResult` in a `shallowRef`; avoid deep watchers on large geometry arrays. The repository's `app/src/components/ChartHost.vue` is a complete example.

`renderChart(svg, input)` and `renderTimeFilter(svg, input)` accept existing `PipelineResult` values. `renderChart` updates keyed SVG marks and caches geometry/path strings; `renderTimeFilter` rebuilds its overview and brush. They use `svg.ownerDocument`, making them suitable for jsdom-based SVG export. Unlike the chart factory, these lower-level functions own the entire supplied SVG. `renderTimeFilter` returns a cleanup function; call it before replacing/removing the filter, including during an active drag. `hitTest(input, x, y)` accepts coordinates in SVG viewBox units and returns the nearest time and layer, or `null` outside the plot.

Graph CSS is scoped to `.braided-stream` and provides fallback values for `--ink`, `--muted`, `--line`, `--accent`, `--accent-soft` and `--font-small`. Tooltips, legends, data loading, local storage and file downloads belong to the consuming application.

`visMethod` accepts `braided` (default) or `streamgraph`. Streamgraph draws each envelope as one unsplit band, matching the former collapsed-branches view. Both methods share geometry and coordinates; branch strokes and time cells apply only to braided mode. Density gradients (`showDensityGradient`, `densityProfileBins`, `densityProfiles`), the former `collapseBranches` option, and star/color-blur methods have been removed.
