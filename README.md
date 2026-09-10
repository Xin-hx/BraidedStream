# Legacy Braided Streamgraph Demo

> **状态（2026-08-15）：** 本目录是可运行的seam-cascade原型，而不是当前论文的Layer-Slot实现。当前论文故事线、数学定义、实现差距、基线与证据门见`../ARTICLE_CURRENT_STATUS.md`。下述页面和功能仅作为遗留实现审计与编码比较资产。

## Route-A independent encoding pages

Run `npm run dev`, then open these exact URLs (Vite's default port):

- `http://localhost:5173/compare-braided.html`
- `http://localhost:5173/compare-zhou-glare.html`
- `http://localhost:5173/compare-twist.html`
- `http://localhost:5173/compare.html` (navigation index)

All three visualization pages use the same synthetic seed (`20260811`), PID order,
L2 wiggle baseline, `560×300` plot dimensions, fixed shared y-domain, palette,
120-step time range, and uncertainty field `u`. Each exports its own standalone SVG.

The Zhou page is a **parameter-adapted visual replication of selected glare-component characteristics from Zhou et al. (2020)**,
DOI [10.1109/TVCG.2020.2970522](https://doi.org/10.1109/TVCG.2020.2970522),
with default threshold `v_t = 0.40` and glare intensity `alpha = 0.60`. It uses
thresholded local sources on fixed 3 px center carriers plus an analytic composite
bloom/colored-halo/ciliary-corona SVG approximation and screen-style composition. `u` is
normalized, and tone mapping is intentionally excluded. This is not a replication
of the full Photographic HDR method, nor an exact computational replication of its physical glare kernel.
The twist page is a pseudo-3D candidate, not real 3D; same-color band with a
periodic crease line plus edge highlight/shadow (fold projected edge) inside a
clip, outer L/U boundaries and layer order unchanged. Its documented
failure risk is apparent q50 shrinkage / false crossing. No perceptual superiority
is claimed for any encoding without the planned user study.

历史样例实现：类别 q50 厚度保持、高不确定区段申请显式接缝空间、公平预算分配，并计算PID代理排序与振幅/频率元数据。当前渲染没有可见的整层正弦位移，不能将其称为Layer-Slot或完整的冗余编码实现。

遗留实现规格见 `METHOD.md`；历史实现批判见 `DECISIONS.md`。当前方法规格以项目根目录`ARTICLE_CURRENT_STATUS.md`为准。

## 运行

```bash
npm install            # 已配置 npmmirror 无妨；Node 18+
npm test               # 31 项测试：原核心性质 + 共享对比夹具/glare/twist不变量
npm run dev            # http://localhost:5173/
npm run build          # 静态产物到 dist/（首页、导航页和3个独立编码页）
```

## 页面

- **首页 `/`**（左侧可收起控制面板）：
  - Dataset：Synthetic（Gate-A 真值 + c8 薄层高不确定）/ COVID new cases（inc case）/ FluSight flu hosp
  - Mode：Base streamgraph / PID order / PID + Braided
  - Encoding：Amplitude + frequency / Amplitude only / Frequency only
  - Baseline：**L2 wiggle**（Byron–Wattenberg）/ **Sine (Gaussian L2)**（SineStream 数学，见 D4）
  - Budget η / Amplitude a_max / Participation τ / f_max / Smooth window / Σq50 参考轮廓
  - Collapse 到基础布局、导出 SVG/PNG、hover 详情（q50、80% PI、u、PID、requested/allocated、freq）
- **对比页 `/compare.html`**：同一数据同一布局下的四种不确定性编码并排——
  Braided（主方法）/ Star markers（五角星大小 ∝ u）/ Glow halo（描边光晕）/ Color + blur（段饱和度+模糊），
  每格可独立导出 SVG（静态对比图，供论文配图）。

## 代码结构

```text
code/                 # 纯 TS 算法包（零 DOM、零运行时依赖）
  types.ts            # 数据 schema
  quantiles.ts        # 分位数校验/插值
  uncertainty.ts      # w_i(t), u_i(t)（层内归一化 + 平滑）
  pid.ts              # PID-lite 区间包含深度 + inside-out 层序
  baseline.ts         # wiggle (L2) 与 sine (SineStream Gaussian L2)
  corridors.ts        # 请求/预算二分 ρ/cascade 递推/braided 几何（含对称化）
  phases.ts           # 相位优化：反相（默认）与 L2 坐标下降（保留）
  costs.ts            # 几何代价报告
  synthetic.ts        # 合成数据生成器（种子 20260811，Gate A 真值 + c8）
  covid.ts            # COVIDhub 加载器（inc case，schema 通用，FluSight 复用）
  dataset/            # 数据源（canonical）：ensemble_covid_inc_case.csv, ensemble_flusight_hosp.csv
demo/                 # 页面：main.ts / compare.ts / render.ts / style.css
scripts/              # copy-dataset.mjs（prebuild 同步 public/）、extract-inc-case.mjs / extract-flusight.mjs
tests/                # vitest
```

## 数据来源

- `ensemble_covid_inc_case.csv`：COVID-19 Forecast Hub 官方 ensemble 的 **1 wk ahead inc case**（新增病例）分位数
  （2020-07~2023-02，50 州 + DC），由 `scripts/extract-inc-case.mjs` 从本地 `Datasets/covid19-forecast-hub` git 仓库提取，并按 Census 四大区聚合。
- `ensemble_flusight_hosp.csv`：FluSight-forecast-hub 官方 ensemble 的 **wk inc flu hosp**（流感新增住院）分位数
  （2023-10~2026-06，85 周，50 州 + DC，horizon=1），由 `scripts/extract-flusight.mjs` 从
  本地 `Datasets/FluSight-forecast-hub` 仓库提取。
- 许可：COVID-19 Forecast Hub 与 FluSight-forecast-hub 数据均为 CC-BY（见上游仓库 LICENSE）；本 demo 使用 50 州 + DC，并按 Census 四大区聚合。

## 已知取舍

- PID 为可复现代理（PID-lite），Gate A 通过前论文措辞须称 "adapted proxy"。
- 撑开外轮廓是 display envelope，不是总体预测区间（Q_p(ΣX) ≠ ΣQ_p(X)）。
- 频率 f_max ≤ T/8 防 alias（默认 T=120 → f_max≤4）。
