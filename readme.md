# Uncertainty-Aware Streamgraph for Time-Series Ensembles

本项目是一个面向 **time-series ensemble data** 的不确定性流图可视分析原型。当前代码把 Covid ensemble 预测数据和 synthetic 数据转换为带 quantile bands 的多层时间序列，并围绕三个核心问题展开：

1. **如何排序 layer**：让中心性更高、趋势更稳定或形态更相似的层处在更适合阅读的位置。
2. **如何选择 baseline**：在保留 streamgraph 美感的同时减少 sine illusion、局部尖峰和中心线突变。
3. **如何表达 uncertainty**：在 ROI 内用 spacing/gap、contour-mask PID 和 spaghetti plot 辅助观察预测不确定性。

当前默认研究路径是：

```text
Covid ensemble quantiles
  -> TPID / PID-time layer ordering
  -> multiscale distributed baseline
  -> ROI uncertainty-aware gap layout
  -> D3/Vue interactive workbench + reproducible reports
```

一句话给自己定位：**这是一个正在走向 TVCG/VIS 论文的可视化算法与系统原型，不是单纯的前端 demo。**

## 快速开始

### 环境

- Node.js：建议 18+ 或 20+
- 包管理：npm
- 前端：Vue 3 + TypeScript + Vite
- 可视化：D3.js

首次运行：

```bash
npm install
npm run dev
```

然后打开 Vite 输出的本地地址。应用包含两个路由：

- `/`：主 Workbench，用于交互式观察、比较、导出。
- `/multiscale-lab`：多尺度 baseline 参数搜索实验台。

构建检查：

```bash
npm run build
```

研究报告脚本：

```bash
npm run report:multiscale
npm run check:multiscale
npm run report:pid-vs-sine
npm run check:core-refactor
```

这些脚本会编译 TypeScript、在 Node 环境中加载核心算法，并在 `reports/` 下生成或检查可复现实验报告。

## 当前项目结构

```text
.
├── Data/
│   └── ensemble_covid.csv                 # Covid ensemble quantile 数据
├── reports/                               # 已生成的研究报告和图形资产
├── scripts/                               # 论文实验/报告生成脚本
├── src/
│   ├── App.vue                            # 手写路由：Workbench / Multiscale Lab
│   ├── WorkbenchPage.vue                  # 主工作台编排
│   ├── app/
│   │   └── sceneBuilder.ts                # 数据 -> 排序 -> baseline -> stack/braid -> metrics
│   ├── core/
│   │   ├── baseline/                      # zero/center/L1/L2/SineStream/multiscale baseline
│   │   ├── ordering/                      # SineStream hierarchical ordering
│   │   ├── optimizing/                    # preset/config/label glue
│   │   ├── ranking/                       # interval PID, contour PID, PID-time scoring
│   │   ├── braid.ts                       # ROI-local uncertainty-aware spacing
│   │   ├── datasets.ts                    # synthetic + Covid 数据加载和 quantile 归一化
│   │   ├── roi.ts                         # ROI clamp/normalization/date lookup
│   │   ├── stack.ts                       # baseline + layer thickness -> yTop/yBottom
│   │   └── types.ts                       # 项目核心类型定义
│   ├── data/
│   │   └── transforms.ts                  # dataset deep clone / preprocess
│   ├── layout/
│   │   ├── metrics.ts                     # 可读性、稳定性、不变量指标
│   │   ├── multiscaleSearch.ts            # multiscale 参数搜索
│   │   └── pidVsSineSearch.ts             # PID ordering vs SineStream 对照搜索
│   ├── render/                            # D3 SVG chart classes
│   ├── views/                             # Vue UI views
│   ├── interactions/                      # SVG/PNG/JSON export, hover, file save
│   └── state/
│       └── appState.ts                    # 默认状态和 UI 控制参数
├── PID.MD                                 # PID 一致性分析，请用 UTF-8 打开
├── SINESTREAM_ANALYSIS.md                 # SineStream 算法分析
├── system status.md                       # 旧版系统架构笔记，部分路径可能已过时
└── package.json
```

## Workbench 怎么读

主界面从上到下大致是：

1. **Global Stream View**
   - 使用 centered baseline 作为上下文视图。
   - 可以选择主时间窗口和 inset ROI。

2. **Enhance Tabs**
   - `Optimizing`：展示排序与 baseline 优化后的结果。
   - `Braided`：展示 ROI 内 uncertainty gap 的局部分离效果。
   - `spaghetti`：展示选中州/地区的 quantile/spaghetti 轨迹。

3. **Compare Drawer**
   - 在 `Optimizing` 下可打开。
   - 默认将当前方案与 SineStream baseline/order 等方案对照。

4. **Export**
   - 导出 SVG、PNG、JSON snapshot。
   - JSON 包含当前 state，适合记录论文实验配置。

默认 state 位于 `src/state/appState.ts`：

```text
datasetKind              = covid
optimizingStage          = tpidMultiscale
orderingScoringMode      = pidTimeWeighted
optimizingBaselineMode   = multiscale
pidTimeAlpha             = 0.8
pidUncertaintySource     = value
covidUncertaintyBand     = 95
enableUncertaintyGap     = true
```

也就是说，当前默认展示的是 **TPID ordering + multiscale baseline**。

## 必备领域知识

### 1. Streamgraph / stacked graph

每个 layer 是一个非负时间序列：

$$
f_i(t) >= 0
$$

stacked graph 将 layers 按某个顺序堆叠，得到每层的上下边界：

```text
yBottom_i(t)
yTop_i(t) = yBottom_i(t) + f_i(t)
```

streamgraph 的关键自由度有两个：

- **Layer ordering**：层的上下顺序。
- **Baseline**：最底部曲线 `b(t)`。

同一批数据，如果排序或 baseline 不同，读者对趋势、厚度、峰值、相似性和不确定性的感知会明显变化。

### 2. Sine illusion

streamgraph 的曲线边界倾斜时，读者容易沿着曲线法向或斜向判断厚度，而不是沿垂直方向判断真实厚度。这类误读常被称作 **sine illusion**。SineStream 的思想是通过 baseline 和排序减少这种错觉，让层的中心线更平滑、相邻层更相容。

项目中 SineStream baseline 的核心是 Gaussian-weighted adjustment：

```text
w_j = exp(-(dF_j^2) / (2c^2))
deltaG = - sum_j(w_j F_j Q_j) / sum_j(w_j F_j)
```

其中 `dF_j` 是 layer 厚度变化，`c` 是 mean/median/geometric/harmonic 形式的变化尺度。

对应代码：

- `src/core/baseline/sineStream.ts`
- `SINESTREAM_ANALYSIS.md`

### 3. Ensemble uncertainty / quantile bands

Covid 数据中每个州/地区有多个 quantile：

```text
q0.025, q0.10, q0.25, q0.50, q0.75, q0.90, q0.975
```

项目将 `q0.50` 作为 layer mean，并支持两种 uncertainty band：

- `95% spread = q97.5 - q2.5`
- `IQR = q75 - q25`

此外还存在 `poportion` 字段。注意：代码里保留了拼写 `poportion`，论文和 README 表述时建议写成 `proportion`，代码变量可后续迁移或兼容别名。

对应代码：

- `src/core/datasets.ts`
- `src/core/types.ts`

### 4. ROI 与 soft support

用户选择一个 ROI 后，项目不会只在 ROI 边界突然改变布局，而是构造一个平滑窗口 `omega(t)`：

```text
omega(t) = 1      inside ROI
omega(t) -> 0    outside ROI with raised-cosine ramp
```

这样可以让 ROI 内的 uncertainty gap 更明显，同时避免边界处突然断裂。

对应代码：

- `src/core/braid.ts`
- `computeOmega(...)`

### 5. Layer ordering

项目目前支持这些排序模式：

| 模式 | 含义 | 代码入口 |
|---|---|---|
| `input` | 原始数据顺序 | `core/ordering/display.ts` |
| `insideOut` | 传统 inside-out 排序 | `core/ordering/display.ts` |
| `sineStream` | SineStream hierarchical clustering + optimal leaf ordering | `core/ordering/sineStream.ts` |
| `intervalInclusion` | 一维 uncertainty band inclusion depth | `core/ranking/pidInterval.ts` |
| `pidMean` | time-value fuzzy mask 的 contour PID-Mean | `core/ranking/pidContour.ts` |
| `pidTimeWeighted` | interval inclusion + temporal stability | `core/ranking/pidTime.ts` |

### 6. PID / TPID 的准确表述

这里要特别小心。当前项目有两类和 PID 相关的东西：

#### A. Interval inclusion ordering

对每个 layer `i` 和时间 `t`，构造 uncertainty interval：

```text
B_i(t) = [L_i(t), H_i(t)]
C_i(t) = clip(q50_i(t), L_i(t), H_i(t))
```

然后看 `C_i(t)` 被多少其他 layer 的区间覆盖：

```text
D_i(t) =
  sum_j w_j(t) * I[C_i(t) in B_j(t)]
  / sum_j w_j(t)
```

宽区间会被降权：

```text
w_j(t) = 1 / (1 + width_j(t) / median_width(t))^p
```

最终 depth 是时间平均：

```text
D_i = mean_t D_i(t)
```

这更准确地叫：

```text
PID-inspired weighted interval inclusion depth
```

或：

```text
uncertainty-band inclusion depth
```

它不是标准 fuzzy contour PID 的等价实现。

#### B. Contour PID-Mean

项目也实现了基于 time-value fuzzy mask 的 contour PID-Mean：

```text
PID-mean(u_i) =
min(
  integral u_i(x) * meanMask(x) dx / integral u_i(x) dx,
  integral u_i(x) * meanMask(x) dx / integral meanMask(x) dx
)
```

这里会把 quantiles rasterize 成二维 time-value membership mask，并生成：

- deepest mask
- all union mask
- central union mask
- central intersection mask

对应代码：

- `src/core/ranking/pidContour.ts`
- `PID.MD`

#### C. TPID / PID-time weighted ordering

当前默认排序是 `pidTimeWeighted`：

```text
score_i = alpha * C_i + (1 - alpha) * R_i
```

其中：

- `C_i`：cross-layer interval inclusion centrality。
- `R_i`：temporal self-inclusion / temporal stability。
- `alpha`：默认 0.8。

这个 score 更像 **time-aware PID-inspired ranking**。论文中建议称为 `Temporal Inclusion Depth Ranking` 或 `TPID-inspired ordering`，并明确说明它和原始 contour PID 的关系。

## 当前算法流水线

### 数据加载

`loadCovidBundle()` 完成：

1. 读取 `Data/ensemble_covid.csv`。
2. 去掉 `US` 总体行。
3. 按 `abbreviation` 分组。
4. 对 quantile 时间序列插值补齐。
5. 强制 quantile 单调。
6. 生成 layer：

```text
id = STATE|h1
mean = q50
unc = q97.5 - q2.5
lower/upper = q2.5/q97.5
unc50Series = q75 - q25
```

### 排序

`buildOptimizingVariantScene(...)` 调用：

```text
computeOptimizingOrder(...)
```

然后根据 preset 选择：

- SineStream order
- interval inclusion
- contour PID-Mean
- PID-time weighted

### Baseline

`computeOptimizingBaseline(...)` 根据模式选择：

- `center`
- `zero`
- `l1`
- `l2`
- `sineStream`
- `multiscale`

当前研究重点是 `multiscale`。

### Multiscale baseline

多尺度 baseline 从 SineStream anchor 出发：

1. 计算 stream centerline：

```text
c(t) = b(t) + H(t)/2
```

2. 取中心线 derivative，检测局部 burst。
3. 用 layer slope signal 构建 Haar-dyadic scale bands。
4. 根据 energy threshold 选择重要尺度。
5. 构造多个 shift basis，并用 coefficient search 找组合。
6. 用 guardrail 防止 layer geometry 指标明显退化。

直观上，它不是把中心线压平，而是把尖锐的一次位移扩散为多个尺度上的小波动，从而减少局部 burst 对阅读的支配。

对应代码：

- `src/core/baseline/multiscale.ts`
- `scripts/check-multiscale-readability.mjs`

### Braided / uncertainty gap

`computeBraidLayout(...)` 在已有 stack 上插入 gap：

```text
rawGap = omega(t) * edgeBoost * (
  gapAlphaPx * uncertainty/slope/thinness signal
  + minVisibleGapPx * visibility
)
```

然后：

- 做 temporal smoothing。
- 限制每个时间点的 total extra height。
- 保持每层厚度不变。

注意：`src/core/braid.ts` 顶部注释里有一句旧注释说当前没有 braiding method，这已经和实际代码不完全一致，建议后续清理，以免影响论文 artifact 可信度。

## 评估指标

主要指标在 `src/layout/metrics.ts` 和报告脚本里。

| 指标 | 目标 | 含义 |
|---|---|---|
| Mean slope | 越低越好 | layer center 平均斜率 |
| Max slope | 越低越好 | 最大局部斜率 |
| Wiggle energy | 越低越好 | layer center 二阶差分能量 |
| Sine-illusion proxy | 越低越好 | 曲率/弯曲代理指标 |
| Centerline peak derivative | 越低越好 | 中心线最大跳变 |
| Derivative concentration | 越低越好 | 最大 derivative / 平均 derivative |
| Top-5% derivative mass | 越低越好 | derivative 是否集中在少数时间点 |
| Slope coverage | 越高越好 | 中心线是否分布式地产生小幅变化 |
| Mean/min separation | 越高越好 | layer 间隔可读性 |
| Extra space / compactness loss | 越低越好 | 布局额外空间代价 |
| Thickness invariance error | 越低越好 | 是否保持真实 layer 厚度 |
| Order stability | 越高越好 | 是否产生 layer overlap/order violation |

## 已有报告怎么理解

### `reports/multiscale_readability_check.md`

最新报告显示：

- Covid H1，56 个 layers，135 个时间点。
- 使用 TPID order + SineStream baseline -> multiscale baseline。
- Main window 和 ROI 都 PASS。
- Covid ROI 中 centerline peak derivative 改善约 57.40%，centerline curvature 改善约 57.50%，readability score 改善约 19.79%。
- simulated burst case 也 PASS，说明 multiscale baseline 对局部 burst 有一定泛化能力。

这份报告是当前最像论文定量证据的材料。

### `reports/multiscale_parameter_report.md`

该报告用固定 order 搜索 multiscale 参数：

- synthetic 上有大量 PASS。
- covid 默认 ROI 上没有 PASS，最佳 candidate 仍失败。

这说明：**仅靠 multiscale baseline 不能保证所有数据/ROI 都改善；ordering 与 ROI 选择对结果很关键。** 论文不能只报成功案例，需要把失败边界说清楚。

### `reports/pid_vs_sine_multiscale_report.md`

该报告比较：

```text
Control: SineStream order + SineStream baseline
Experiment: PID order + Multiscale baseline
```

结果：

- Covid：大量 PASS，最佳 ROI/global 均有明显改善。
- Synthetic：全部 FAIL，说明 PID ordering 对 synthetic 的 generalization 不足。

论文中可以把它转化为一个研究问题：

```text
RQ: uncertainty-centered ordering 在真实 ensemble forecast 数据上是否优于 purely shape-based ordering？
```

但必须补充更多 datasets 和 ablations。

## TVCG / VIS 发表要求对齐

提交前务必核对当年的官方页面。以下是按 IEEE VIS 2026 / TVCG special issue 官方信息整理的工作清单：

- IEEE VIS 2026 full papers accepted 后进入 TVCG special issue。
- 2026 full paper 采用 `9 + 2` 页限制：最多 9 页正文内容，加最多 2 页 references / supplemental links / acknowledgements / figure credits 等材料。
- 论文需要使用 IEEE VIS TVCG Journal submission formatting，并建议在全文中使用高质量彩色图。
- 官方鼓励在第一页顶部放 teaser image。
- 需要清晰说明 novelty/significance，并把贡献放在 TVCG、VIS、VAST、InfoVis、SciVis、CHI、UIST、EuroVis、PacificVis 等相关工作背景下。
- 补充材料在 VIS 2026 中有单独截止时间；代码、数据、视频、demo、appendix 等都可作为 supplemental。
- Open Practices 鼓励把可复现实验材料上传到可靠长期 archive，并提供足够文档和可复用 license。
- 官方 review instructions 明确：VIS 论文不一定必须有 user study，但需要用合适方式证明 correctness、usefulness、usability 或 impact。

官方链接：

- IEEE VIS 2026 Paper Submission Guidelines: https://www.ieeevis.org/year/2026/info/call-participation/paper-submission-guidelines/
- IEEE VIS 2026 Open Practices: https://ieeevis.org/year/2026/info/open-practices/open-practices/
- IEEE VIS 2026 Review Instructions: https://www.ieeevis.org/year/2026/info/call-participation/review-instructions/

## 当前工作距离 TVCG 的缺口

### 1. 贡献边界还需要收紧

目前项目包含：

- SineStream 复现/改造
- TPID ordering
- contour PID-Mean
- multiscale baseline
- uncertainty gap/braiding
- spaghetti plot
- parameter lab

这些东西都重要，但论文不能像功能堆叠。建议最终凝聚成一个主命题：

```text
Uncertainty-aware streamgraph layout for time-series ensembles:
combine time-aware inclusion ordering, multiscale baseline redistribution,
and ROI-local uncertainty separation to improve readability and uncertainty inspection.
```

不要把所有模块都声称为同等创新。可以分为：

- 主贡献：TPID ordering + multiscale baseline 的联合 layout framework。
- 次贡献：ROI uncertainty gap 和 contour/spaghetti 作为 inspection views。
- 工程贡献：可复现实验与交互原型。

### 2. PID 术语风险

`PID.MD` 已经指出：interval inclusion ordering 与标准 probabilistic inclusion depth 不等价。

论文中应避免写：

```text
We implement Probabilistic Inclusion Depth.
```

建议写：

```text
We adapt the intuition of probabilistic inclusion to time-series uncertainty bands
and define a time-aware interval inclusion score for layer ordering.
```

如果要正式使用 `PID`，需要明确：

- 哪个模块是 contour-mask PID-Mean。
- 哪个模块是 PID-inspired interval inclusion。
- 两者输入对象、积分/区间定义、输出用途不同。

### 3. 数据集不足

当前主要真实数据是 Covid ensemble。TVCG/VIS 需要更强外部有效性：

- 至少 2-3 个真实 ensemble time-series 数据集。
- 至少 1-2 个 synthetic controlled benchmarks。
- 数据应覆盖不同层数、不同时间长度、不同不确定性结构。

候选方向：

- epidemic forecasts
- weather ensemble forecasts
- energy demand/load forecasts
- mobility/traffic forecasts
- climate model ensemble time series

### 4. Baseline 对照不足

至少需要以下 baselines：

- Original order + centered baseline
- Inside-out + L2/wiggle baseline
- SineStream order + SineStream baseline
- SineStream order + multiscale baseline
- TPID order + SineStream baseline
- TPID order + multiscale baseline
- PID-Mean order + multiscale baseline
- Ablation: no temporal stability term
- Ablation: no uncertainty term
- Ablation: no multiscale guardrail
- Ablation: no ROI uncertainty gap

这样才能回答：

- 改善来自 ordering 还是 baseline？
- 来自 uncertainty-aware score 还是普通 shape score？
- 来自 multiscale redistribution 还是普通 smoothing？
- gap 是否提升 uncertainty inspection，而不仅仅增加空间？

### 5. 统计验证不足

当前报告多为 single-run / selected-window。需要扩展为：

- across datasets
- across ROIs
- across random seeds if any randomness exists
- across parameter grids
- paired statistical tests or bootstrap confidence intervals
- effect sizes

建议每个数据集自动采样多个 ROI：

```text
global windows
high uncertainty windows
high slope/burst windows
low uncertainty control windows
random windows
```

### 6. Human evaluation 还缺

官方不强制 user study，但对可视化系统论文来说，以下至少要有一种：

- controlled perceptual study：比较趋势判断、厚度判断、不确定性定位。
- expert review / case study：让领域用户解释 Covid/weather/energy ensemble 中的 insight。
- qualitative design study：围绕 domain tasks、迭代设计、lessons learned。
- 如果涉及人类参与者，需要提前准备 IRB / ethics approval / exemption 说明，以及招募、任务、风险和数据匿名化方案。

如果时间有限，建议做一个轻量但严谨的 task-based study：

```text
Task A: identify time interval with largest forecast uncertainty.
Task B: compare two states/layers and judge which has more stable central trend.
Task C: detect whether a peak is data-driven or layout-induced.
Task D: rank candidate visualizations by readability/confidence.
```

### 7. Artifact 可信度还要加强

建议补齐：

- `README.md` 当前文件。
- `LICENSE`。
- `CITATION.cff`。
- deterministic scripts for all paper figures/tables。
- `npm run reproduce:paper` 或等价脚本。
- small sample data，避免全量数据不可用时无法运行。
- CI：build + report smoke checks。
- generated figure list 与 paper figure 对应关系。

## 推荐论文贡献表述

可以考虑以下贡献列表：

1. **A task-driven design for uncertainty-aware streamgraphs** that supports global trend reading, ROI-focused uncertainty inspection, and comparison among ensemble members.
2. **A time-aware interval inclusion ordering method** that ranks layers by cross-layer uncertainty-band centrality and temporal stability.
3. **A multiscale baseline redistribution algorithm** that reduces concentrated centerline derivative bursts while preserving layer thickness and bounded stream geometry.
4. **An ROI-local uncertainty separation layout** that allocates smooth gaps according to uncertainty, slope, and thin-layer visibility.
5. **A reproducible evaluation suite** with quantitative metrics, parameter search, and comparison reports against SineStream and other layout baselines.

## 推荐研究问题

```text
RQ1: Does TPID ordering improve uncertainty-centered readability compared with SineStream and inside-out ordering?
RQ2: Does the multiscale baseline reduce centerline derivative bursts without increasing layer wiggle or distortion?
RQ3: Does ROI-local uncertainty separation improve uncertainty inspection while preserving global context?
RQ4: Which datasets and ROI types benefit most, and where does the method fail?
RQ5: How sensitive is the method to alpha, waveStrength, energyThreshold, and uncertainty band choice?
```

## 下一步研究计划

### Week 1: 固化命题与术语

- 将论文主线固定为 `uncertainty-aware streamgraph layout for time-series ensembles`。
- 把 UI 和报告中的 `PID` 术语分为：
  - `Interval Inclusion`
  - `Time-aware Inclusion / TPID`
  - `Contour PID-Mean`
- 清理 `poportion` 的论文表述，必要时加兼容字段 `proportion`。
- 更新旧文档中已经过时的路径和注释。

### Week 2: 建立可复现实验矩阵

- 新增 `scripts/generate-paper-results.mjs`。
- 统一输出 CSV/JSON：
  - dataset
  - ROI type
  - ordering mode
  - baseline mode
  - metric before/after/delta/improvement
  - pass/fail reasons
- 至少覆盖 Covid + synthetic burst + 另一个真实 ensemble 数据。

### Week 3: 消融实验

需要把论文最容易被问的问题提前答掉：

- TPID vs interval-only
- TPID vs contour PID-Mean
- multiscale vs SineStream
- multiscale vs simple smoothing
- with/without uncertainty gap
- 50% IQR vs 95% spread
- value vs proportion uncertainty source

### Week 4: 视觉图件

TVCG/VIS 很看重图。建议准备：

- Figure 1：teaser，展示同一 ROI 下 SineStream 与本方法差异。
- Figure 2：系统 pipeline。
- Figure 3：TPID ordering 示例和公式。
- Figure 4：multiscale baseline 从 burst 到 distributed wave 的过程。
- Figure 5：ROI uncertainty gap 的局部效果。
- Figure 6：quantitative summary across datasets/ROIs。
- Figure 7：case study insight。
- Supplement：参数敏感性 heatmaps。

### Week 5: Human / expert validation

最小可行方案：

- 8-12 名参与者或 3-5 名领域专家。
- 对比 SineStream、centered streamgraph、本方法。
- 收集 task accuracy、completion time、confidence、NASA-TLX 或简短主观评分。
- 对专家访谈进行 qualitative coding，提炼设计启发。
- 提前确认 IRB/伦理审批或豁免是否需要，避免实验完成后无法写进论文。

### Week 6: 写作与投稿包

- 先写 9 页主文档骨架。
- 所有实验图表固定脚本生成。
- 补充材料包含：
  - code
  - data preprocessing notes
  - full metric tables
  - demo video
  - parameter search logs
  - questionnaire / study protocol if有 user study

## 深入学习 TODO

### Visualization

- Streamgraph / stacked graph layout
- ThemeRiver and streamgraph design history
- SineStream and sine illusion
- Uncertainty visualization
- Ensemble visualization
- Time-series visual analytics
- Design study methodology
- Visualization evaluation and perceptual study design

### Statistics / Math

- Quantiles and prediction intervals
- Functional boxplots
- Contour boxplots
- Data depth functions
- Probabilistic inclusion depth
- Rank correlation: Spearman, Kendall tau
- Wavelet / Haar multiscale analysis
- Multi-objective optimization and guardrails
- Bootstrap confidence intervals

### Engineering

- D3 SVG rendering architecture
- Vue Composition API
- Deterministic experiment scripting
- Reproducible research artifact packaging
- CI for TypeScript + report generation
- Large CSV loading and preprocessing

## 投稿前检查清单

### 论文主张

- [ ] 明确一句话贡献。
- [ ] 不夸大 PID，区分 interval inclusion 与 contour PID。
- [ ] 明确适用场景和失败场景。
- [ ] 对 SineStream、ThemeRiver、uncertainty vis、ensemble vis 有完整 related work。

### 算法

- [ ] 给出 ordering、baseline、gap layout 的正式定义。
- [ ] 证明或实验验证 thickness invariance。
- [ ] 给出复杂度分析。
- [ ] 给出参数默认值与敏感性分析。

### 实验

- [ ] 至少 2-3 个真实数据集。
- [ ] synthetic controlled benchmarks。
- [ ] 完整 baselines。
- [ ] 完整 ablations。
- [ ] 多 ROI，多 seed 或 deterministic 说明。
- [ ] 显著性或置信区间。
- [ ] 如果有人类参与者实验，IRB/伦理审批或豁免说明已准备。

### 系统

- [ ] 可交互 demo 稳定。
- [ ] 所有 paper figures 可复现。
- [ ] README、LICENSE、CITATION、supplement 完整。
- [ ] 代码注释和旧文档清理。

### TVCG/VIS 包装

- [ ] 9+2 页格式符合当年官方模板。
- [ ] 第一页 teaser 足够强。
- [ ] 图中文字可读、配色清晰、色盲友好。
- [ ] supplemental 有 demo video、code/data、实验表格。
- [ ] Open practices / archive / license 方案确定。

## 推荐从这里开始读代码

如果你今天只想快速掌握项目，建议按这个顺序：

1. `src/state/appState.ts`  
   看默认实验配置。

2. `src/WorkbenchPage.vue`  
   看 UI state 如何驱动三条 scene。

3. `src/app/sceneBuilder.ts`  
   看完整算法流水线。

4. `src/core/datasets.ts`  
   看 Covid quantiles 如何变成 layers。

5. `src/core/ranking/pidInterval.ts` 和 `src/core/ranking/pidTime.ts`  
   看默认 TPID ordering。

6. `src/core/baseline/multiscale.ts`  
   看当前最核心的 baseline 创新。

7. `src/core/braid.ts`  
   看 ROI uncertainty gap。

8. `src/layout/metrics.ts`  
   看所有论文指标。

9. `reports/multiscale_readability_check.md`  
   看当前最强实验证据。

10. `PID.MD`  
    看 PID 术语边界，避免论文表述踩坑。

## 当前最重要的研究建议

优先把项目从“有很多可视化功能”收敛成“一个可以被审稿人复现并信服的算法贡献”。

最值得立刻做的三件事：

1. **扩大数据与 ROI 实验矩阵**：解决 generalization 质疑。
2. **做 ablation**：证明 TPID、multiscale、uncertainty gap 各自有贡献。
3. **准备用户或专家验证**：证明这些指标改善确实转化为阅读和分析收益。

做到这三点后，这个项目才会更像 TVCG/VIS 论文，而不是一个漂亮的内部原型。
