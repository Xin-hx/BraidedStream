# METHOD — Braided 布局的正式化数学定义（可复现规格）

> **遗留实现规格（2026-08-15）：** 本文件定义当前`Demo/code`中的seam-cascade原型，不是当前论文的Layer-Slot方法定义。当前论文数学、实现差距和后续替换边界见项目根目录`ARTICLE_CURRENT_STATUS.md`及`../Code/reports/sponge-layer-slot-corridor-mathematical-model-v1.md`。

本文件是 `code/` 算法包的实现依据。所有定义均为离散、确定性、可复现；
与主线的差异及理由见 `DECISIONS.md`。记号：层 i=1..n（自上而下序号 k=0..n−1 见 M2），时刻 t=0..T−1。

## M1. 数据与校验

分位数集合 P = {0.025, 0.10, 0.25, 0.50, 0.75, 0.90, 0.975}。
类别 i 在时刻 t 提供分位数 Q_i(t,p) ≥ 0。
校验（violate 即拒绝并报告）：对每个 (i,t)：p 增序 ⇒ Q_i(t,p) 单调不减（容差 −1e−9）；
缺失分位数：整层缺失 ⇒ 拒绝；单点缺失 ⇒ 线性插值（端点外推为最近邻）。

基础厚度与总量：

```math
m_i(t)=Q_i(t,0.50),\qquad H_0(t)=\sum_{i=1}^{n} m_i(t).
```

分位数语义声明（展示文案强制）：Q_p(ΣX)≠ΣQ_p(X)；撑开外轮廓是 display envelope，不是总体预测区间。

## M2. 层序（PID-lite + inside-out）

深度（概率包含代理，移植自老 Code IntervalPidCalculator 的数学）：

```math
D_i=\frac{1}{|T_i|}\sum_{t\in T_i}
\frac{\sum_{j\ne i} \rho_{ij}(t)\,\mathbf{1}\bigl[Q_i(t,.5)\in[Q_j(t,.10),Q_j(t,.90)]\bigr]}
{\sum_{j\ne i} \rho_{ij}(t)},\qquad
\rho_{ij}(t)=\Bigl(1+\frac{w_j(t)}{w_{\mathrm{med}}(t)}\Bigr)^{-1},
```

其中 w_med(t) 为 t 时刻各层宽度中位数，T_i 为有效时刻集（至少 2 个比较层）。D_i∈[0,1]：高=靠近集合共识，低=偏离。

层序：按 D 降序，排成 inside-out 序列 seq（最深居中）：seq = [d_{⌈n/2⌉−1}, d_{⌈n/2⌉−2}, …, d_0, d_{⌈n/2⌉}, …]（即经典 streamgraph 中心向外）。基础布局按 seq 堆叠。

## M2.5 基础布局（两种可选，见 DECISIONS.md D4）

- **wiggle（默认）**：Byron–Wattenberg 均匀权重 L2 斜率最小化，垂直居中。
- **sine**：SineStream Gaussian 加权 L2（TVCG 2021，DOI 10.1109/TVCG.2020.3030404，参考实现 `参考文献/SineStream/javascript/Layout_Ours.js`）。层序固定时，该 baseline 即下述 Gaussian 加权 L2 优化的递推解：

```math
b(0)=-H(0)/2,\qquad
b(t)=b(t-1)-\frac{\sum_j g_j(t)\,m_j(t)\,Q_j(t)}{\sum_j g_j(t)\,m_j(t)},
```

其中 dF_j(t)=m_j(t)-m_j(t-1)，c(t)=median_j|dF_j(t)|，g_j(t)=exp(-dF_j(t)²/(2c(t)²))（c=0 时 g=1），Q_j(t)=Σ_{k<j}dF_k(t)+dF_j(t)/2。c 也可取 mean/geometric/harmonic（默认 median）。

## M3. 类别内不确定性

宽度（默认 80% 区间）：

```math
w_i(t)=Q_i(t,0.90)-Q_i(t,0.10)\ge 0.
```

层内归一化（默认；global 模式见 D1）：

```math
u_i(t)=\begin{cases}
w_i(t)/W_i, & W_i=\max_{\tau}w_i(\tau)>0,\\
0, & W_i=0,
\end{cases}\qquad u_i(t)\in[0,1].
```

可选零相位平滑：u ← 居中移动平均（窗 σ 步，默认 3；σ=0 关闭）。u 与 q50 无关 ⇒ q50≈0 无除零风险。

## M4. 走廊请求

参与掩码与幅度请求（参数：阈值 τ∈[0,1]，默认 0.30；幅度 a_max>0，默认 3% y 数据范围；幂指数 γ 默认 1）：

```math
p_i(t)=\mathbf{1}[u_i(t)\ge\tau],
\qquad a_i^{\mathrm{req}}(t)=a_{\max}\,u_i(t)^{\gamma}\,p_i(t),
\qquad c_i^{\mathrm{req}}(t)=2a_i^{\mathrm{req}}(t)+\delta.
```

δ=最小净空（默认 0.2% y 数据范围）。y 数据范围 Y = [0, max_t H_0(t)]（含 5% 边距）。

## M5. 频率、积分相位与位移窗

频率（参数 f_min=0.5、f_max=4，单位：整个跨度的周期数；约束 f_max≤T/8）：

```math
f_i(t)=f_{\min}+(f_{\max}-f_{\min})\,u_i(t).
```

积分相位（离散化，Δτ=1/(T−1)）：

```math
\theta_i(0)=\phi_i,\qquad
\theta_i(t+1)=\theta_i(t)+2\pi f_i(t)\,\Delta\tau.
```

位移窗（参与掩码的零相位平滑，窗长 κ 默认 5 步 ⇒ 淡入淡出，端点自然为 0）：

```math
w_i^{\mathrm{win}}(t)=\mathrm{smoothed}(p_i(\cdot))[t]\in[0,1].
```

编码模式（u 驱动幅度和/或频率）：both：ã 随 u（经预算）、f 随 u；amplitude-only：f_i≡f_min；
frequency-only：a_i^{\mathrm{req}}≡a_max·mean_t u_i（常数幅度，仍受预算压缩），f 随 u。

## M6. 预算分配（全局公平压缩）

预算 B(t)=η·H₀(t)，η∈[1,3] 默认 1.6。逐时刻二分 ρ(t)∈[0,1]（12 次迭代，容差 1e−6×H₀）：

```math
\tilde a_i(t)=\rho(t)\,a_i^{\mathrm{req}}(t),
\qquad \rho(t)=\min\Bigl\{\rho:\ \mathrm{cascadeHeight}(t;\rho\tilde a)\le B(t)\Bigr\}.
```

**引理（等价性）**：若把预算按请求比例分配给各冲突分量，即 B_C(t)=B(t)·Σ_{i∈C}c_i^{req}/Σ_i c_i^{req}，
则 ρ_C(t)=min(1, B_C/Σ_{i∈C}c_i^{req})=min(1, B(t)/Σ_i c_i^{req}) 对所有 C 恒等 ⇒ 全局统一压缩是主线 §5.2
"分量公平压缩"在预算按请求比例分配下的忠实实现，且更简单可复现。
冲突分量定义（仅报告）：时刻 t 的图 G_t，边 (i,i+1) 当 ã_i(t)+ã_{i+1}(t)+δ>0（即至少一方参与，存在走廊需求）；
连通分量即 C(t)。报告每分量成员与压缩后比例。

## M7. 位移场与 Braided 几何（cascade）

外包络（含间隙 δ 的总厚度，即"撑开后含间隙的总厚度"）：

```math
E_i^{\mathrm{low}}(t)=L_i(t)+s_i(t)-\tilde a_i(t),\qquad
E_i^{\mathrm{high}}(t)=U_i(t)+s_i(t)+\tilde a_i(t).
```

摆动位移（实际局部位移，主线 §4.4 的 o 离散化）：

```math
o_i(t)=\tilde a_i(t)\,w_i^{\mathrm{win}}(t)\,\sin\theta_i(t).
```

布局位移 cascade（保证 E_{i+1}^{low}−E_i^{high}≥δ 逐层成立；s_1(t)=0 底部锚定）：

```math
s_{i+1}(t)=\max\bigl(0,\; s_i(t)+\tilde a_i(t)+\tilde a_{i+1}(t)+\delta\bigr)
```

（因基础布局相邻 U_i=L_{i+1}，该式恰为包络间隙约束的递推解）。最终边界：

```math
L_i^*(t)=L_i(t)+s_i(t)+o_i(t),\qquad
U_i^*(t)=U_i(t)+s_i(t)+o_i(t),\qquad
U_i^*-L_i^*=m_i \ \text{(精确保持)}.
```

总包络高度 cascadeHeight(t)=U_n(t)+s_n(t)+ã_n(t)（+顶部余量）。渲染时整图垂直居中。

## M8. 相位优化（两种方式，均以外包络计算间隙）

相邻包络间隙（含 δ 检查目标）：

```math
\mathrm{gap}_{i,i+1}(t)=\bigl(L_{i+1}(t)+s_{i+1}(t)-\tilde a_{i+1}(t)\bigr)
-\bigl(U_i(t)+s_i(t)+\tilde a_i(t)\bigr).
```

**sine（解析反相）**：φ_k = π·(k mod 2)（k=0..n−1 按 inside-out 序列），即相邻层目标相差 π；
s 由 cascade 递推；O(nT)，零迭代。

**L2（数值优化）**：变量 φ=(φ_1..φ_n)，能量

```math
E(\phi)=\lambda_c\sum_{t}\sum_{\langle i,i+1\rangle}\max(0,\delta-\mathrm{gap}_{i,i+1}(t))^2
+\lambda_s\sum_{i}\sum_{t=1}^{T-1}\bigl(o_i(t)-o_i(t-1)\bigr)^2,
```

λ_c=1.0、λ_s=0.5。坐标下降：3 轮，每轮每层在 [φ_i−π/2, φ_i+π/2] 均匀 17 点取最优（固定网格 ⇒ 确定性）。
注意 gap 计算在 s 递推之后，且 L2 只调 φ（幅度/频率仍由 u 决定，编码语义不被优化器改变）。

## M9. 几何代价（report-only，不进入优化）

```math
\begin{aligned}
&\text{heightRatio}(t)=H^*(t)/H_0(t);\quad \text{max/mean over }t.\\
&\text{collisions}=\#\{(t,i):\mathrm{gap}_{i,i+1}(t)<\delta-10^{-9}\}.\\
&\text{curvature}=\sum_i\sum_t (\Delta^2 y_i(t))^2,\quad \text{slope}=\sum_i\sum_t (\Delta y_i(t))^2 \quad(\text{基础 vs 撑开对比}).\\
&\text{displacement}=\sum_i\sum_t |s_i(t)| \quad(\text{非局部位移}).\\
&\text{allocRatio}=\sum_{i,t}\tilde a_i(t)/\sum_{i,t}a_i^{\mathrm{req}}(t)\in[0,1].\\
&\text{phaseContinuity}=\max_{i,t}|\theta_i(t{+}1)-\theta_i(t)-2\pi f_i(t)\Delta\tau|\ (=0\ \text{by construction}).
\end{aligned}
```

## M10. 合成数据生成器（种子可复现）

mulberry32(seed)。真值类型（每类一个 profile）：
共识簇 c0–c3：μ 共享基线+小幅个体波形；宽覆盖 c4：σ 全时段 ×2.5；
持续离群 c5：μ 常数偏移 +0.8；短时偏离 c6：t∈[40%,60%] 时段 μ 偏移 −1.2 且 σ×2。
分位数：q_p=exp(μ_i(t)+σ_i(t)·Φ⁻¹(p))（Φ⁻¹ 用有理逼近），天然正、严格单调。
σ_i(t)=σ0·(1+2·gauss(t;t_p,σ_t))，t_p 为不确定性峰值时段 ⇒ 高不确定区段明确可见。
T=120, n=8。输出 QuantileBands{P 全部 7 档}。

## M11. COVID 数据（code/dataset/ensemble_covid_inc_case.csv）

层=州子集 {FL,PA,IL,OH,GA,MI,NJ,VA}；value=COVIDhub-ensemble **1 wk ahead inc case**（新增病例）预测分位数；
quantiles 取 P 全集（0.025/0.10/0.25/0.50/0.75/0.90/0.975）。时间=周（target_end_date）。
hover 附加 per-capita（value/population）。提取脚本 `scripts/extract-inc-case.mjs`（从本地 covid19-forecast-hub 仓库）。

## M11b. FluSight 流感住院数据（code/dataset/ensemble_flusight_hosp.csv）

层=Census 四大区（50 州 + DC 聚合）；value=FluSight-ensemble **wk inc flu hosp**（流感新增住院）分位数，horizon=1；
quantiles 同 P 全集；时间=周（target_end_date，2023-10-21~2026-06-06，85 周，无缺失）。
提取脚本 `scripts/extract-flusight.mjs`（本地仓库 `Datasets/FluSight-forecast-hub`，sparse checkout 仅 `model-output/FluSight-ensemble`）。

## M12. Publication iteration 1: shared-scale explicit seams (supersedes M3-M8 geometry)

This section records the formulas implemented by the publication pipeline as of 2026-08-13. Where M3-M8 above describe per-layer normalization, Boolean participation, moving-average windows, permanent clearance, oscillatory offsets, or phase optimization, M12 supersedes them.

For the 80% interval width, one dataset-wide calibration is used:

```math
w_i(t)=Q_i(t,.90)-Q_i(t,.10),\qquad
W=\max_{i,t}w_i(t),\qquad
u_i(t)=\begin{cases}w_i(t)/W,&W>0\\0,&W=0.\end{cases}
```

The default pipeline does not smooth `u`. Optional smoothing remains a diagnostic API option only. Therefore equal raw widths anywhere in the same dataset have equal `u`.

Let `tau_c` and `tau_o` be shared close/open thresholds, with `tau_o>tau_c`. The compact event gate is the cubic smoothstep

```math
z_i(t)=\frac{u_i(t)-\tau_c}{\tau_o-\tau_c},\qquad
g_i(t)=\begin{cases}
0,&u_i(t)\le\tau_c,\\
3z_i(t)^2-2z_i(t)^3,&\tau_c<u_i(t)<\tau_o,\\
1,&u_i(t)\ge\tau_o.
\end{cases}
```

The same `g` controls the amplitude envelope, gate-weighted clearance, and adjacent seam request:

```math
a_i^{req}(t)=a_{max}u_i(t)^\gamma g_i(t),\qquad
d_j^{req}(t)=a_j^{req}(t)+a_{j+1}^{req}(t)
+\delta\max(g_j(t),g_{j+1}(t)).
```

For `B(t)=eta H_0(t)`, the retained request is the supremum feasible common ratio (not a minimum-feasible ratio):

```math
\rho(t)=\begin{cases}
1,&\sum_jd_j^{req}(t)=0,\\
\min\left(1,\frac{\max(0,B(t)-H_0(t))}{\sum_jd_j^{req}(t)}\right),&\text{otherwise},
\end{cases}
\qquad d_j(t)=\rho(t)d_j^{req}(t).
```

Define cumulative offsets `r_0(t)=0`, `r_{i+1}(t)=r_i(t)+d_i(t)`, and center them by `s_i(t)=r_i(t)-n^{-1}\sum_k r_k(t)`. Final geometry is

```math
L_i^*(t)=L_i(t)+s_i(t),\qquad U_i^*(t)=U_i(t)+s_i(t).
```

Thus `U_i^*-L_i^*=q50_i` exactly and the displayed adjacent seam is

```math
L_{i+1}^*(t)-U_i^*(t)=d_i(t)\ge0.
```

If both adjacent gates are zero, `d_i(t)=0` exactly; no fixed clearance remains. Total displayed height is `H^*(t)=H_0(t)+\sum_j d_j(t) <= B(t)`. Phase/frequency arrays remain compatibility diagnostics, but phase optimization is not invoked and phase does not alter publication geometry.

Synthetic uncertainty uses staggered layer-local compact bumps

```math
b(x)=\begin{cases}\exp(1-1/(1-x^2)),&|x|<1\\0,&|x|\ge1,\end{cases}
```

instead of one shared Gaussian or rectangular transients. Selected layers have different centers and supports, creating local separation-rejoining windows with exact calm states before and after.
