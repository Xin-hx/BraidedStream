# BraidedStream

[简体中文](README_zh.md)

Distribution-valued streamgraphs, with a standalone TypeScript + D3 package and a Vue 3 application. The analysis pipeline and visualization do not depend on Vue.

## Run

Use Node 26+ (or a Node version supported by the installed jsdom), with npm:

```sh
npm install
npm run dev
```

Open the Vite URL. The app includes illustration ensembles and COVID model members. TCM prescriptions are available only in local development when private records are present. Controls cover visualization method, baseline, KDE bandwidth, contours, density encoding, time filtering and SVG download. The legend supports sorting, layer focus and browser-local color settings.

```sh
npm test
npm run test:package
npm run build
npm run preview
```

Production builds include only the public Illustration and COVID datasets. TCM records are local only and are excluded even when present on disk. `npm run build` builds the package, checks TypeScript/Vue types and builds the frontend. `test:package` packs and installs the package in a temporary project, then checks runtime behavior and strict NodeNext types.

## Reusable package

```ts
import { select } from 'd3';
import { braidedStream } from 'braided-stream';
import 'braided-stream/style.css';

const chart = braidedStream().options({ width: 1180, height: 620 });
select(svg).datum(dataset).call(chart);
```

For independent analysis, use `runPipeline` from `braided-stream/core`. Bind `{ dataset, result }` to reuse computed geometry. Hover and brush events connect the chart to your own UI. No framework adapter is required.

```sh
npm run build:package
npm pack --workspace braided-stream
```

See [package documentation](packages/braided-stream/README.md) for input examples, options, events, lifecycle, CSS and Vue integration. No npm publication is performed by these commands.

## Organization

- `packages/braided-stream/`: analysis, input validation, D3 rendering, basic interaction and chart styles.
- `app/`: Vue single-file components, data loading, tooltips, legend persistence and SVG download.
- `examples/converters/`: converters and metadata for the three example datasets.
- `examples/data/`: example source data.
- `scripts/figures/`: paper figure generation scripts consuming the package.
- `docs/`: documentation assets and reports.
- `artifacts/`: ignored generated output and local backups.
- Tests live beside the app/package; `tests/integration/` contains cross-module regression, data-boundary and packed-install checks.

## Paper figures

Build the package first, then run from the repository root:

```sh
npm run build:package
npm run figures:covid
npm run figures:tcm
npm run typecheck
```

The scripts write figures and supporting files under `artifacts/figures/`. They use the independent package, without importing the application UI. TCM and COVID examples describe observed/model distributions and do not establish causal effects.

## Local-only TCM data

Place authorized clinical records at `examples/data/private/TCMRecord.csv`. The file and directory are Git-ignored. Never copy them into public assets or force-add them. The development server binds to loopback and exposes records only to local clients; direct filesystem access is blocked. Production builds hide the TCM selector and never copy the file.

Without private records, public builds/tests work and real TCM checks skip automatically. Synthetic TCM tests still run. TCM-derived figures and sample exports remain under ignored `artifacts/figures/`. See [data handling](examples/data/README.md).
