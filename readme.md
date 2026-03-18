# Braided StreamGraph Demo

## 1. 项目做什么
这是一个基于 `TypeScript + D3 + Vite` 的研究原型，用来演示 Braided StreamGraph：

1. 在主视图展示全局 stacked streamgraph。
2. 在 ROI（感兴趣时间窗）内引入可控 gap，形成 braided 布局。
3. 在 inset 视图中对比 `before`（原堆叠）和 `after`（加 gap 后）差异。
4. 用指标面板量化可读性变化与约束是否满足。

## 2. 快速运行
```bash
npm install
npm run dev
```

构建与预览：
```bash
npm run build
npm run preview
```

## 3. 最小架构（单向数据流）
`UI 控件变化 -> 更新 AppState -> redraw() -> 数据预处理 -> baseline/stack/braid -> 三个图渲染 -> metrics 渲染`

入口是 `src/main.ts`，所有交互最终都回到一次 `redraw()`，保证状态和画面同步。

## 4. 目录职责

### `src/main.ts`
应用编排层：绑定控件、维护状态、调用计算与渲染、处理 hover/导出。

### `src/state`
- `appState.ts`: 全局运行状态结构与默认值（baseline、gapMode、ROI、insetMode 等）。

### `src/core`
- `types.ts`: 核心类型定义（`PreparedDataset`、`StackLayout`、`BraidLayout`、`ROI`）。
- `datasets.ts`: synthetic/covid 数据构建与归一化，缺失不确定性时自动生成代理不确定性。
- `synthetic.ts`: 合成数据生成器。
- `baseline.ts`: `computeBaseline()`，支持 `zero/center/sineStream`。
- `stack.ts`: `computeStackedBoundaries()`，把 baseline + layer mean 变成上下边界。
- `braid.ts`: `computeBraidLayout()`，在 ROI 支撑区计算 `omega/gap` 并生成 braided 边界。
- `roi.ts`: ROI 规范化与父窗约束。
- `validate.ts`: 时序长度校验、层顺序校验、不确定性读取。
- `assertions.ts`: 不变量检查（厚度守恒、ROI 外不变、无重叠、omega 合法等）。

### `src/data`
- `transforms.ts`: 预处理（平滑、聚合、降采样）。
- `loadCovid.ts`: covid 数据加载封装。

### `src/render`
- `overviewChart.ts`: 概览时间带 + ROI brush。
- `mainChart.ts`: 主图渲染 + inset ROI 高亮与 brush。
- `insetChart.ts`: ROI 局部视图，支持 `before/after/diff/split`。
- `uncertainty.ts`: gap 内不确定性语义绘制。
- `metricsPanel.ts`: 指标表格渲染。
- `paths.ts`: area path 生成工具。
- `legends.ts`: gap 图例文本。
- `chart.ts`: 旧版集成图类（当前主流程未直接使用）。

### `src/layout`
- `metrics.ts`: before/after 指标计算。
- `roiRecommend.ts`: ROI 候选窗口推荐。

### `src/interactions`
- `presets.ts`: 预设参数组合（Readability/Uncertainty/Compact/Presentation）。
- `hover.ts`: tooltip 数据与文案。
- `export.ts`: 导出 SVG/PNG/JSON。
- `files.ts`: 浏览器端文件下载。

### `src/ui`
- `brush.ts`: 统一 ROI brush 控件封装。

## 5. 关键语义
1. `before`: 原始堆叠布局（`StackLayout`），不含 braid gap。
2. `after`: braided 布局（`BraidLayout`），在 ROI 周围按 `omega(t)` 注入 gap。
3. `ROI`: 主时间窗。
4. `Inset ROI`: ROI 内更小局部窗，用于放大对比。

## 6. 最简规约（改代码时保持）
1. `core` 只做计算，尽量保持纯函数，不直接操作 DOM。
2. `render` 只负责画图，不改业务状态。
3. 状态写入集中在 `main.ts` 的事件处理与 `createInitialState()`。
4. 新交互应回到 `redraw()` 主流程，避免局部绕过导致视图不一致。
5. ROI 相关输入都先过 `normalizeROI/clampRoiToParent`。
6. 新增布局逻辑后应保留 `runInvariantChecks()`，保证几何约束可验证。

## 7. 扩展入口建议
1. 新数据源：从 `src/core/datasets.ts` 增加 loader 并输出 `PreparedDataset`。
2. 新 gap 语义：在 `src/render/insetChart.ts` 与 `src/render/uncertainty.ts` 扩展。
3. 新指标：在 `src/layout/metrics.ts` 增加行，并由 `MetricsPanel` 自动展示。
