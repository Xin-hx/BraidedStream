# PID Consistency Report

本文比较当前项目中的 PID-inspired layer ordering 与 GitHub 参考实现 [Probabilistic-Inclusion-Depth](https://github.com/cenyangWu/Probabilistic-Inclusion-Depth)。结论是：**两者原理不一致**。因此，在当前实现下不应直接绘制 GitHub 意义上的 contour boxplot；若要绘制，需要先为当前 time-series streamgraph 数据定义 time-value mask 或 contour ensemble 表示。

## 1. Current Local Implementation

本项目当前实现位于 [src/core/pidOrdering.ts](src/core/pidOrdering.ts)。

它的输入是 streamgraph layer 的时间序列：

- `mean[t]`
- quantile bands，例如 `p025/p975`, `p05/p95`, `p10/p90`, `p25/p75`
- 或 fallback 的 `lower/upper`, `mean ± unc/2`

每个 layer `i` 在时间 `t` 被转成一维不确定性区间：

$$
B_i(t)=[L_i(t),H_i(t)]
$$

中心值为：

$$
C_i(t)=clip(p50_i(t),L_i(t),H_i(t))
$$

当前 depth 的核心是：看 `C_i(t)` 被多少其他 layer 的区间覆盖。

$$
D_i(t)
=
\frac{
\sum_{j\ne i} w_j(t)\mathbf{1}[C_i(t)\in B_j(t)]
}{
\sum_{j\ne i}w_j(t)+\varepsilon
}
$$

其中宽区间会被降权：

$$
w_j(t)
=
\frac{1}{(1+|B_j(t)|/median_B(t))^p}
$$

最终 layer depth 是时间平均：

$$
D_i
=
\frac{1}{|T_i|}
\sum_{t\in T_i}D_i(t)
$$

因此，本地方法更准确的名称是：

> `PID-inspired weighted interval inclusion depth`

或：

> `uncertainty-band inclusion depth`

它是一个面向 streamgraph layer ordering 的启发式概率中心性指标，而不是 GitHub repo 中完整的 probabilistic inclusion depth。

## 2. GitHub Reference Implementation

GitHub repo: <https://github.com/cenyangWu/Probabilistic-Inclusion-Depth>

相关代码：

- `PID/Boxplot.py`
  - `probabilistic_inclusion_depth_cpu(...)`
  - `probabilistic_inclusion_depth(...)`
- `PID/ScatterplotMatrix.py`
  - `probabilistic_inclusion_depth_cpu(...)`
  - `compute_epsilon_inclusion_depth(...)`

GitHub 方法处理的是 fuzzy contour 或 binary contour ensemble。每个 ensemble member 是一个概率 mask：

$$
u_i(x)\in[0,1]
$$

概率包含算子定义为：

$$
u \subset_p v
=
\frac{\int u(x)v(x)d\mu}{\int u(x)d\mu}
$$

完整 PID 对每个 contour 同时计算 inward 与 outward inclusion：

$$
IN_{in}^{p}(u_i)
=
\frac{1}{N}
\sum_{j=1}^{N}
(u_i\subset_p u_j)
$$

$$
IN_{out}^{p}(u_i)
=
\frac{1}{N}
\sum_{j=1}^{N}
(u_j\subset_p u_i)
$$

最终：

$$
PID(u_i)
=
\min\{IN_{in}^{p}(u_i),IN_{out}^{p}(u_i)\}
$$

GitHub 中的高效版本 `PID-Mean` 使用 mean contour：

$$
\bar u(x)=\frac{1}{N}\sum_i u_i(x)
$$

并计算：

$$
PID\text{-}mean(u_i)
=
\min\left\{
\frac{\int u_i(x)\bar u(x)d\mu}{\int u_i(x)d\mu},
\frac{\int u_i(x)\bar u(x)d\mu}{\int \bar u(x)d\mu}
\right\}
$$

这正对应 `PID/Boxplot.py` 中的实现：

```python
dot_product = np.sum(masks_flattened * original_center, axis=1)
s1 = dot_product / area_masks
s2 = dot_product / area_center
depths = np.minimum(s1, s2)
```

该方法用于生成 contour boxplot，例如 deepest member、top-50% union、top-50% intersection、all-mask union 等。

## 3. Formula-Level Mismatch

两者名字都使用 PID 语义，但数学对象不同。

| 维度 | 当前项目 | GitHub PID |
|---|---|---|
| 数据对象 | time-series layer uncertainty band | fuzzy/binary contour mask |
| 基本元素 | 一维区间 `[low(t), high(t)]` | 空间概率函数 `u(x)` |
| inclusion 含义 | `center_i(t)` 是否落入其他区间 | `u ⊂p v = ∫uv / ∫u` |
| depth 方向 | 只看被其他区间覆盖 | 同时看 `IN_in` 与 `IN_out` |
| 最终聚合 | 对时间平均 | 对空间积分，并对 ensemble 成员聚合 |
| 宽度/面积处理 | 对宽区间启发式降权 | 由 mask area 分母自然归一化 |
| 输出用途 | layer 排序和 center-out display | contour boxplot / depth ranking |

最关键的不一致是：

1. 当前项目没有构造概率 mask `u_i(x)`。
2. 当前项目没有计算 `u_i ⊂p u_j`。
3. 当前项目没有同时计算 inward/outward inclusion 并取 `min`。
4. 当前项目的 width penalty 是为避免宽区间“占便宜”的启发式修正，不是 GitHub PID 公式的一部分。

所以，当前方法不能被称为 GitHub repo 的等价实现。

## 4. Pros and Cons

### 4.1 Current Method

优点：

- 简单快速，复杂度适合交互式 layer ordering。
- 直接适配当前 Covid time-series quantile bands，不需要额外 rasterization。
- 语义直观：中心轨迹经常落入其他不确定性区间的 layer，更像群体共识层。
- 可自然服务于 streamgraph 的 center-out 绘制策略。

缺点：

- 不是双向 PID，没有 `IN_in/IN_out` 的对称性。
- 不是 mask/contour based，无法直接生成 contour boxplot。
- 宽区间降权是启发式设计，需要在论文中说明。
- 只测试中心值是否被覆盖，不能完整表达两个不确定分布之间的形状重合。

### 4.2 GitHub PID Method

优点：

- 数学定义完整，直接基于 probabilistic inclusion operator。
- 支持 fuzzy contours 与 binary contours。
- 同时考虑 inward/outward inclusion，能避免只偏向“大而宽”的 contour。
- 可生成 deepest member、central region、top-50% union/intersection 等 contour boxplot 结构。

缺点：

- 需要每个 ensemble member 都表示为 mask 或 contour。
- 对当前 streamgraph layer 数据不能直接套用，需要先定义 time-value mask。
- 如果把 uncertainty band rasterize 成二维 mask，需要决定分辨率、阈值、归一化方式和时间/数值轴度量，这些都会影响结果。
- 计算和可视化流程比当前 layer-ordering 方法更重。

## 5. Contour Plot Decision

因为当前实现与 GitHub PID 原理不一致，本轮不绘制 contour plot。

如果后续要绘制 GitHub 意义上的 contour boxplot，需要新增建模步骤：

1. 把每个州/地区的 uncertainty band 转成 time-value mask：

   $$
   u_i(t,y)=\mathbf{1}[L_i(t)\le y\le H_i(t)]
   $$

   或使用软边界概率 mask。

2. 对所有 `u_i(t,y)` 计算 GitHub PID 或 PID-Mean。
3. 用 depth rank 生成 contour boxplot：
   - deepest member
   - top-50% union
   - top-50% intersection
   - all-member union
4. 再讨论该 contour boxplot 与 streamgraph layer ordering 的关系。

在完成这些建模选择之前，推荐论文中采用下面表述：

> Our current ordering uses a PID-inspired weighted interval inclusion depth over time-series uncertainty bands. It is conceptually motivated by inclusion depth, but it is not equivalent to the probabilistic mask-based PID used for fuzzy contour ensemble boxplots.

## 6. Recommendation

当前项目中应避免直接写：

> We implement Probabilistic Inclusion Depth from Wu et al.

更准确的说法是：

> We use a PID-inspired weighted interval inclusion depth for uncertainty-band streamgraph ordering.

或者：

> We adapt the intuition of inclusion depth to time-series uncertainty bands by measuring how often each layer center is covered by peer uncertainty intervals.

这样既保留了“概率包含深度”的设计动机，也避免把当前实现误描述为 GitHub `Probabilistic-Inclusion-Depth` 的直接复现。

