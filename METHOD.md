# Braided Stream 方法

## 1. 单一的代表量与外部轮廓入口

对 layer `i`、时刻 `t`，唯一的下游解析入口为
`resolveLayerQuantiles(layer, time, envelopeQuantile, representativeQuantile)`：

```text
representative = Qrho, where 0.025 <= rho < eta
external contour = Qeta, where 0.5 < eta <= 0.975
default: rho = 0.50, eta = 0.90
```

对 COVID hybrid layer，两个值均取自 official trained-ensemble quantiles；只对
未提供的 Qp 做相邻 quantile knot 的线性插值。页面只提供原生的 Q90/Q97.5，
因此 COVID case study 的默认路径不发生插值。component member Q50 不参与
representative 或 contour 的计算。

`Qeta >= Qrho`，所以代表彩色厚度为 `H = Qrho`，而 `Qeta` 只定义可用的
最大 deformation budget `G = E - H`。实际总分离量为 `D = lambda * G`：

```text
envelopeHeight = E = H + G
deformation = D = lambda * G
```

其中 `lambda` 是从全局 uncertainty rank 得到的 visual exposure。`Qeta` envelope
始终占据 `E` 的高度；`D` 只决定其中有多少空间用于内部 gap，余下的 `G-D` 保持为
透明 envelope。单模态没有内部 gap，因此不分配 deformation space。`Qeta` 是用户控制的最大空间上限，**不是**
`[Q2.5, Q97.5]` predictive interval；Q2.5 与 Q97.5 仅保留给 uncertainty
默认计算与 tooltip。代表 statistic 和 envelope statistic 都可由页面控件选择。

## 2. 分支拓扑与守恒

对 component model 的 submitted median `z_m = Q50^(m)` 与归一化 trained
weight `w_m`，在 `log1p` 尺度做 KDE：

```text
u_m = log(1 + z_m)
f(u) = sum_m w_m K_h(u - u_m)
```

mode 位置以 `exp(u)-1` 映射回病例数坐标；带宽仍为同一州各时间点 weighted
Silverman bandwidth 的中位数。TPID 使用同一组权重：
`S(v) = sum_m w_m 1[z_m >= v]`。

KDE 的 valley basin 定义分支，分支质量是该 basin 中 component 权重之和
`pi_k`。其彩色厚度为：

```text
h_k = pi_k * Qrho
sum_k h_k = Qrho
```

`K`、`pi_k` 和 mode 位置 `c_k` 完全由 distribution shape 与时间持久化规则
决定，不读取 uncertainty。即使 `u=0`，这些 branch 在拓扑上仍然存在；因为同色、
零间隔且默认无内部描边，它们视觉上合并为 conventional stream。KDE member Q50
与 trained-ensemble Qp 是两个有意区分的统计对象：前者表达
performance-weighted model-center disagreement，后者表达 official ensemble 的
上侧 forecast contour。

## 3. 不确定性 exposure 与相对分支排列

每个 layer 可直接提供 `uncertainty: number[]` 作为分析者定义的归一化不确定性
信号；长度必须与时间点数一致，且所有值必须在 `[0, 1]`。未提供该字段时，默认
使用相对分位数宽度：

```text
U = (Q97.5 - Q2.5) / (Q97.5 + epsilon)
```

将所有 layer/time 的 `U` 转换为 upper empirical-CDF percentile rank `r`。用户选择
要展示的最高不确定性比例 `p`，令 `tau = 1 - p/100`，并通过线性映射：

```text
lambda = 0,                              r < tau
lambda = (r - tau) / (1 - tau),          r >= tau
D = lambda * (Qeta - Qrho)
```

得到 visual exposure。`p=0` 定义为全部 `lambda=0`；`U=0` 也保持
`lambda=0`，避免全零数据因 percentile ties 被完全展开。默认 `p=10`。该映射不
改变 KDE 模态数、分支质量或 mode 顺序。

对按值递增排列的 mode `c_1 < ... < c_K`，只有相邻 mode distance 决定 `K-1` 个
内部 gap 的相对比例：

```text
d_k = c_(k+1) - c_k,  k = 1, ..., K-1
dbar_k = d_k / sum_j d_j
g_k = D * dbar_k
sum_k g_k = D
```

若所有距离均为零，则等分 `D`。branch 从槽底开始按
`h_1, g_1, ..., g_(K-1), h_K` 排列，不再将 `c_k` 直接当作画布坐标，也不分配
tail 或外部 margin。因此 distribution shape 决定怎么散开，uncertainty rank 只决定
总共散开多少，且总彩色厚度始终为 `Qrho`。`lambda=0` 时所有 gap 为零；`lambda=1`
时多模态 layer 使用完整空间预算。Q2.5/Q97.5 只用于默认 `U` 的计算，不参与
branch 几何。`Qeta` envelope 槽边界始终显示，即使 `lambda=0`；`Collapse` 仅隐藏分支，
不改变底层拓扑。

## 4. 时间连续性边界

KDE 带宽在每个 category 内跨时间固定，且多模态 branch count 只有连续至少三个
时间点才保留，用于抑制短暂 topology flicker。绘制时的 basis curve 只平滑路径，
不改变离散时间点上的数值。percentile rank、跨越 `tau`、持久化 topology 的起止点，
以及快速变化的 mode-distance ratios 仍可能造成真实的间隔跳变；当前实现没有对
`U`、`r`、`lambda` 或 `g_k` 做额外时间滤波，以保持上述 mapping 可审计。
