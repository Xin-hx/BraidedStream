# System Architecture - Streamgraph Optimization Demo

```mermaid
graph TD
    ENTRY["main.ts"] --> APP["App.vue"]
    APP --> WB["WorkbenchPage.vue"]
    WB --> STATE["state/appState.ts"]
    WB --> SCENE["app/sceneBuilder.ts"]
    SCENE --> BASE["core/baseline"]
    SCENE --> ORDER["core/ordering"]
    SCENE --> STACK["core/stack.ts"]
    SCENE --> METRICS["layout/metrics.ts"]
    WB --> RENDER["render/charts.ts"]
    WB --> VIEWS["views"]
    WB --> INTERACTIONS["interactions"]
```

## Data Flow

```text
Dataset
  -> preprocessDataset()
  -> orderLayers()/optimizeLayerOrder()
  -> computeBaseline()/computeOptimizingBaseline()
  -> computeStackedBoundaries()
  -> computeMetrics()
  -> D3/Vue rendering
```

## Notes

- `SceneBuildResult.afterLayout` is a plain `StackLayout`.
- The deprecated ROI gap layout is not part of the active system.
- Inset titles show the view mode, jagged-edge state, and interactivity only.
