# System Architecture — Braided Streamgraph Demo

```mermaid
graph TD
    %% ── Entry ──
    ENTRY["main.ts\n(Vue app bootstrap)"]
    ENTRY --> APP

    %% ── App Shell ──
    subgraph APP_SHELL["App Shell"]
        APP["App.vue\n(client-side router)"]
        WB["WorkbenchPage.vue\n(main workspace)"]
        LAB["MultiscaleLabPage.vue\n(parameter grid-search lab)"]
        APP -->|"/"| WB
        APP -->|"/multiscale-lab"| LAB
    end

    %% ── State ──
    subgraph STATE["State"]
        AS["state/appState.ts\nAppState interface\n+ createInitialState()"]
    end

    %% ── Scene Builder ──
    subgraph SCENE["Scene Builder"]
        SB["app/sceneBuilder.ts\nbuildScene()\nbuildOptimizeComparisonScene()\nbuildBraidedEnhanceScene()"]
    end

    WB --> STATE
    LAB --> STATE
    WB --> SCENE
    LAB -.->|"reuses fixed-order pipeline"| SCENE

    %% ── Core ──
    subgraph CORE["Core Domain"]
        TYPES["types.ts\nshared domain types\n(BaselineMode, ROI, LayerInput,\nStackLayout, BraidLayout, ...)"]
        BASE["baseline.ts\nbaseline solvers\n(sineStream, center, zero,\nL1/L2 wiggle, multiscale)"]
        STACK["stack.ts\nstack geometry\n(baseline + layers -> yTop/yBottom)"]
        BRAID["braid.ts\nbraid layout\n(uncertainty-aware gaps,\nROI support window, spacing)"]
        ORDER["optimizeOrder.ts\nhierarchical layer ordering\n(SineStream-style clustering\n+ optimal leaf ordering)"]
        ORDER_CMP["orderCompare.ts\norder comparison and\nnormalization"]
        PID["pid.ts\nunified PID module\n(interval PID ordering,\ncontour-mask PID, PID-Mean)"]
        DS["datasets.ts\ndataset loading\n(synthetic + covid bundles)"]
        ROI["roi.ts\nROI normalization and\nclamping"]
        SEED["seed.ts\nfixed seed constant"]
        VALIDATE["validate.ts\nvalidation utilities"]
        SYNTH["synthetic.ts\nsynthetic data generation"]
        UTILS["utils.ts\ngeneral math/array helpers"]
    end

    SCENE --> CORE

    %% ── Layout ──
    subgraph LAYOUT["Layout & Search"]
        METRICS["metrics.ts\nlayout quality metrics\n(wiggle, meanSlope, illusion)"]
        MULTI_SEARCH["multiscaleSearch.ts\ngrid search for multiscale\nbaseline parameters"]
        PID_METRICS["pidMetrics.ts\nPID ordering metric bundle\n(Spearman rho, Kendall tau)"]
        PID_VS_SINE["pidVsSineSearch.ts\nPID vs SineStream\ncomparison search"]
        ROI_REC["roiRecommend.ts\nROI recommendation\n(highest uncertainty, slope,\nwiggle, local change)"]
        SEARCH_UTILS["searchUtils.ts\nshared search helpers"]
    end

    SCENE --> LAYOUT

    %% ── Data ──
    subgraph DATA["Data Pipeline"]
        TRANSFORMS["data/transforms.ts\npreprocessDataset()\n(deep-clone layers and times)"]
    end

    SCENE --> DATA

    %% ── Render ──
    subgraph RENDER["Render Layer (D3.js)"]
        MAIN_CHART["render/mainChart.ts\nMainChart class\n(main streamgraph + ROI brush)"]
        OVERVIEW["render/overviewChart.ts\nOverviewChart\n(minimap context view)"]
        INSET["render/insetChart.ts\nInsetChart\n(detail before/after/diff/split)"]
        PID_NEW_CHART["render/pidNewChart.ts\nPidNewChart\n(PID contour boxplot\n+ ordered river panels)"]
        PATHS["render/paths.ts\nSVG area path generation"]
        CHART_UTILS["render/chartUtils.ts\nshared chart helpers\n(axis labels, crosshair, layout)"]
    end

    WB --> RENDER

    %% ── Views ──
    subgraph VIEWS["Vue View Components"]
        CONTROL["views/ControlPanelView.vue\nsidebar controls"]
        GLOBAL["views/GlobalStreamView.vue\noverview + main chart"]
        INSET_V["views/InsetDetailView.vue\ndetail inset (optimize/braid)"]
        SPAGHETTI["views/SpaghettiView.vue\nspaghetti plot"]
        PID_ORD_V["views/PidOrderingView.vue\nPID ordering visualization"]
        PID_NEW_V["views/PidNewView.vue\nPID new visualization"]
        METRICS_V["views/MetricsView.vue\nmetrics table"]
    end

    WB --> VIEWS
    LAB -.-> METRICS_V

    %% ── Interactions ──
    subgraph INTERACTIONS["Interactions"]
        EXPORT["interactions/export.ts\nSVG/PNG/JSON export"]
        FILES["interactions/files.ts\nbrowser file saving"]
        HOVER["interactions/hover.ts\nhover tooltip"]
    end

    WB --> INTERACTIONS

    %% ── UI ──
    subgraph UI["UI Primitives"]
        BRUSH["ui/brush.ts\nD3 ROI brush controller"]
    end

    RENDER --> UI

    %% ── Styles ──
    STYLES["styles/palette.ts\ncolor palette"]

    RENDER --> STYLES

    %% ── Key data flow (dashed) ──
    STATE -.->|"AppState"| SCENE
    DATA -.->|"PreparedDataset"| SCENE
    CORE -.->|"StackLayout / BraidLayout"| SCENE
    LAYOUT -.->|"MetricResult / SearchResult"| SCENE
    SCENE -.->|"SceneBuildResult"| WB
```

## Data Flow Summary

```
Dataset (JSON)
  │
  ▼
data/transforms.ts          ← preprocess (deep-clone)
  │
  ▼
core/optimizeOrder.ts        ← hierarchical layer ordering
  │
  ▼
core/baseline.ts             ← baseline computation
  │
  ▼
core/stack.ts                ← stack geometry (yTop / yBottom)
  │
  ▼
core/braid.ts                ← braid layout (uncertainty gaps)
  │
  ▼
layout/metrics.ts            ← quality metrics
  │
  ▼
render/*.ts                  ← D3 SVG rendering
```

## Module Dependency Layers

| Layer | Modules | Role |
|-------|---------|------|
| **Entry** | `main.ts` | Vue app bootstrap |
| **Shell** | `App.vue`, `WorkbenchPage.vue`, `MultiscaleLabPage.vue` | Routing, page composition |
| **State** | `state/appState.ts` | Centralized app state |
| **Scene** | `app/sceneBuilder.ts` | Orchestration: dataset → order → baseline → stack → braid → metrics |
| **Core** | `core/*.ts` (12 files) | Domain logic, algorithms, types |
| **Layout** | `layout/*.ts` (6 files) | Search strategies, metric computation |
| **Render** | `render/*.ts` (6 files) | D3.js SVG charts |
| **Data** | `data/transforms.ts` | Data preprocessing |
| **Interaction** | `interactions/*.ts` (3 files) | Export, file I/O, hover |
| **UI** | `ui/brush.ts`, `styles/palette.ts` | Brush control, colors |
| **Views** | `views/*.vue` (7 files) | Reusable Vue components |

## Tech Stack

- **Framework**: Vue 3.5 (Composition API + `<script setup>`)
- **Language**: TypeScript 5.6
- **Build**: Vite 5.4
- **Visualization**: D3.js 7.9
- **Routing**: Manual client-side router (no vue-router)

## Key Architectural Decisions

1. **Scene-builder pattern** — `sceneBuilder.ts` acts as a stateless orchestrator: it takes `AppState` + `DatasetBundle`, runs the full pipeline (order → baseline → stack → braid → metrics), and returns an immutable `SceneBuildResult`. Views are pure renderers of that result.

2. **No Vue Router** — Routing is handled manually in `App.vue` via `window.location.pathname` and `popstate`, switching between `WorkbenchPage` and `MultiscaleLabPage`.

3. **Reactive state via `reactive()`** — AppState is a single reactive object passed down as props; no Pinia or Vuex store.

4. **D3 in classes** — Each chart (MainChart, OverviewChart, InsetChart, PidNewChart) is a plain TypeScript class that owns its D3 selections and exposes render/update methods, keeping D3 imperative code separate from Vue's declarative rendering.

5. **Dual baseline comparison** — The "optimize" tab computes two layouts (before=SineStream, after=method) and renders them side-by-side; the "braided" tab renders a single braided layout with uncertainty gaps.
