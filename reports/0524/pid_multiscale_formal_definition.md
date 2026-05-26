# 本项目 PID 与 multiscale 的简单形式化定义

生成日期：2026-05-24

## 0. 一句话结论

本项目里涉及的 PID 不是单一版本，而是一组相关但用途不同的定义：

| 版本 | 代码/文档位置 | 一句话说明 |
|---|---|---|
| Reference PID | `PID.MD` 中对 GitHub `Probabilistic-Inclusion-Depth` 的说明 | 原始概率包含深度：比较一个概率轮廓是否被另一个概率轮廓包含 |
| Contour PID / PID-Mean | `src/core/pid.ts` 的 `computeContourPid` | 把 quantile band 栅格化成 fuzzy mask，再用 mean mask 算 PID-Mean |
| Interval PID ordering | `src/core/pid.ts` 的 `computePidOrdering` | 当前 streamgraph 排序主方法：看一个 layer 的中心线是否落在其他 layer 的不确定区间里 |
| PID time-weighted score | `src/core/layerScoring.ts` | 在 interval PID 的基础上，加上时间稳定性项 |
| Python TPID prototype | `tpid_ordering.py` | Python 原型：quantile membership + cross-layer TPID + temporal self-inclusion |

代码里的 `value / poportion` 是同一套 PID 公式的两种数据来源，不是两套数学方法。`poportion` 是项目代码中已有拼写。

---

## 1. Reference PID：概率包含深度

这个版本是项目文档中用来对照的外部 PID，不是当前 layer ordering 的直接实现。

### 1.1 数据对象

每个对象不是一条线，而是一张概率图：

$$
u_i(x)\in[0,1]
$$

白话解释：

- \(u_i\)：第 \(i\) 个对象的概率轮廓。
- \(x\)：图上的一个位置，可以理解成一个小格子。
- \(u_i(x)=0\)：这个位置完全不属于对象。
- \(u_i(x)=1\)：这个位置非常属于对象。
- 介于 0 和 1：有一部分属于对象。

### 1.2 两个对象之间的“包含程度”

$$
I(u,v)=\frac{\sum_x u(x)v(x)}{\sum_x u(x)+\varepsilon}
$$

白话解释：

- \(I(u,v)\)：问“\(u\) 有多少被 \(v\) 接住了”。
- \(\sum_x\)：把所有小格子的数加起来。
- \(u(x)v(x)\)：两个对象在同一个格子都大的地方，重叠就大。
- \(\sum_x u(x)\)：\(u\) 自己的总大小。
- \(\varepsilon\)：一个极小数，防止分母为 0。

### 1.3 完整 PID

$$
IN_{in}(u_i)=\frac{1}{N}\sum_{j=1}^{N} I(u_i,u_j)
$$

$$
IN_{out}(u_i)=\frac{1}{N}\sum_{j=1}^{N} I(u_j,u_i)
$$

$$
PID(u_i)=\min\{IN_{in}(u_i),IN_{out}(u_i)\}
$$

白话解释：

- \(N\)：一共有多少个对象。
- \(IN_{in}\)：第 \(i\) 个对象被别人包含得多不多。
- \(IN_{out}\)：第 \(i\) 个对象能不能包含别人。
- 取 \(\min\)：两边都要好才算深。只“大而宽”不能占便宜。

为什么这么做：  
只看“我被别人包含”会偏向小对象，只看“我包含别人”会偏向大对象。取较小值，可以让最中心、最有代表性的对象排在前面。

---

## 2. Contour PID / PID-Mean：项目中的 mask 版本

位置：`src/core/pid.ts` 的 `computeContourPid`。

它先把每个 layer 的 quantile band 变成一张 fuzzy mask，再和平均 mask 比较。

### 2.1 从 quantile 到 membership mask

项目使用这些 membership anchor：

| quantile | membership |
|---|---:|
| `p025`, `p975` | 0 |
| `p10`, `p90` | 0.25 |
| `p25`, `p75` | 0.5 |
| `p50` | 1 |

形式化写法：

$$
U_i(t,y)\in[0,1]
$$

白话解释：

- \(U_i(t,y)\)：第 \(i\) 个 layer 在时间 \(t\)、数值高度 \(y\) 上的 membership。
- 时间 \(t\)：横轴上的一个日期或采样点。
- 数值 \(y\)：纵轴上的一个高度。
- 越靠近 p50，membership 越接近 1；越靠近外层分位线，membership 越接近 0。

### 2.2 平均 mask

$$
\bar U(t,y)=\frac{1}{N}\sum_{i=1}^{N}U_i(t,y)
$$

白话解释：

- \(\bar U\)：所有 layer 的平均模样。
- 它像“大家共同形成的中心形状”。

### 2.3 PID-Mean 分数

$$
A_i=\sum_{t,y}U_i(t,y)
$$

$$
A_{\bar U}=\sum_{t,y}\bar U(t,y)
$$

$$
O_i=\sum_{t,y}U_i(t,y)\bar U(t,y)
$$

$$
PIDMean_i=\min\left\{\frac{O_i}{A_i+\varepsilon},\frac{O_i}{A_{\bar U}+\varepsilon}\right\}
$$

白话解释：

- \(A_i\)：第 \(i\) 个 mask 自己有多大。
- \(A_{\bar U}\)：平均 mask 有多大。
- \(O_i\)：第 \(i\) 个 mask 和平均 mask 重叠了多少。
- 第一项 \(O_i/A_i\)：它自己有多少落在平均形状里。
- 第二项 \(O_i/A_{\bar U}\)：平均形状有多少被它覆盖。
- 取较小值：既不能太窄，也不能太宽。

为什么这么做：  
这个版本适合做 contour boxplot，例如 deepest mask、top-50% union、top-50% intersection。它比 interval PID 更接近原始 Probabilistic Inclusion Depth 的 mask 思路。

---

## 3. Interval PID ordering：当前 streamgraph 排序主版本

位置：`src/core/pid.ts` 的 `computePidOrdering`。

这是项目当前最重要的 layer ordering 版本。

### 3.1 每个 layer 在每个时间点的区间

$$
B_i(t)=[L_i(t),H_i(t)]
$$

$$
C_i(t)=clip(Q_{i,50}(t),L_i(t),H_i(t))
$$

白话解释：

- \(B_i(t)\)：第 \(i\) 个 layer 在时间 \(t\) 的不确定区间。
- \(L_i(t)\)：区间下边界。
- \(H_i(t)\)：区间上边界。
- \(C_i(t)\)：中心值，优先用 p50；如果没有，就用 mean。
- `clip`：如果中心值跑到区间外，就把它拉回区间内。

区间来源优先级：

1. quantile pairs：`p025/p975`、`p05/p95`、`p10/p90`、`p25/p75`。
2. fallback：`lower/upper` 或 `poportionLower/poportionUpper`。
3. fallback：`mean ± unc/2` 或 `poportionMean ± poportionUnc/2`。
4. 如果都没有，就退化成 `[mean, mean]`。

### 3.2 宽区间降权

$$
W_j(t)=H_j(t)-L_j(t)
$$

$$
M(t)=median\{W_j(t):j\ne i\}
$$

$$
w_j(t)=\frac{1}{(1+W_j(t)/M(t))^p}
$$

白话解释：

- \(W_j(t)\)：第 \(j\) 个区间有多宽。
- \(M(t)\)：同一时刻其他区间宽度的中位数，可以理解成“典型宽度”。
- \(p\)：宽区间惩罚强度，代码默认是 1。
- \(w_j(t)\)：第 \(j\) 个区间投票的重量。
- 区间越宽，越容易覆盖别人，所以要降权。

### 3.3 单个时间点的 depth

$$
D_i(t)=
\frac{
\sum_{j\ne i}w_j(t)\mathbf{1}[C_i(t)\in B_j(t)]
}{
\sum_{j\ne i}w_j(t)+\varepsilon
}
$$

白话解释：

- \(D_i(t)\)：第 \(i\) 个 layer 在时间 \(t\) 的中心程度。
- \(\mathbf{1}[C_i(t)\in B_j(t)]\)：如果 \(i\) 的中心落在 \(j\) 的区间里，就是 1；否则是 0。
- 分子：覆盖了 \(i\) 的其他 layer 的加权票数。
- 分母：所有可比较 layer 的总票数。
- 结果接近 1：它的中心经常落在别人不确定范围里，说明它比较“中心”。
- 结果接近 0：它更像边缘层。

### 3.4 layer 总 depth

$$
D_i=\frac{1}{|T_i|}\sum_{t\in T_i}D_i(t)
$$

白话解释：

- \(T_i\)：第 \(i\) 个 layer 有有效比较结果的时间点集合。
- \(|T_i|\)：有效时间点数量。
- \(D_i\)：把所有时间点的 depth 求平均。

排序规则：

1. 按 \(D_i\) 从大到小排序。
2. 如果分数相同，再用总 mean 做辅助比较。
3. 视觉上用 center-out 排布：最中心的 layer 放到流图中间，其他 layer 向上下交替展开。

为什么这么做：  
streamgraph 需要一个“谁放中间、谁放边缘”的顺序。Interval PID 用的是简单直观的判断：一个 layer 的中心轨迹越常落在其他 layer 的不确定带里，它越像群体的共同中心。

---

## 4. PID time-weighted score：加入时间稳定性

位置：`src/core/layerScoring.ts`。

这个版本不重新定义区间 depth，而是在 `D_i(t)` 的基础上加一个时间稳定性项。

### 4.1 跨层中心性

$$
C_i=\frac{1}{|T_i|}\sum_{t\in T_i}D_i(t)
$$

白话解释：

- \(C_i\)：layer \(i\) 的平均跨层中心性。
- 这就是 interval PID 的总 depth。

### 4.2 时间自包含/稳定性

$$
R_i(t)=clip(1-|D_i(t)-D_i(t-1)|,0,1)
$$

$$
R_i=\frac{1}{|T_i|-1}\sum_{t>1}R_i(t)
$$

白话解释：

- \(R_i(t)\)：相邻两个时间点的 PID depth 是否稳定。
- 如果 \(D_i(t)\) 和 \(D_i(t-1)\) 很接近，差值小，\(R_i(t)\) 接近 1。
- 如果变化很大，\(R_i(t)\) 变小。
- `clip`：保证结果在 0 到 1 之间。

### 4.3 两种排序模式

普通中心性模式：

$$
Score_i=C_i
$$

时间加权模式：

$$
Score_i=\alpha C_i+(1-\alpha)R_i
$$

白话解释：

- \(\alpha\)：中心性和稳定性的权衡，代码默认 0.8。
- \(\alpha\) 越大，越看重“是否中心”。
- \(\alpha\) 越小，越看重“是否稳定”。

为什么这么做：  
有些 layer 平均很中心，但时间上忽上忽下。时间加权版本会偏向既中心又稳定的 layer。

---

## 5. Python TPID prototype：quantile membership + temporal PID

位置：`tpid_ordering.py`。

这是一个更完整的 Python 原型，把每个 layer 的 quantile 分布先变成 membership，再同时看跨层中心性和时间连续性。

### 5.1 membership tensor

$$
U_i(t,y)=g(\hat F_i(t,y))
$$

白话解释：

- \(U_i(t,y)\)：第 \(i\) 个 layer 在时间 \(t\)、高度 \(y\) 上的 membership。
- \(\hat F_i(t,y)\)：用 quantile 插值得到的“\(y\) 大概处在分布的哪个分位”。
- \(g\)：把分位数转成中心 membership 的函数。
- 默认 anchor 是：0.025 -> 0，0.25 -> \(a\)，0.5 -> 1，0.75 -> \(a\)，0.975 -> 0。
- \(a\)：四分位处的 membership，默认 0.5。

### 5.2 membership 之间的包含

$$
I(u,v)=\frac{\sum_y u(y)v(y)}{\sum_y u(y)+\varepsilon}
$$

白话解释：

- 和 Reference PID 类似，只是这里固定在某一个时间 \(t\)，沿着纵向网格 \(y\) 加总。

### 5.3 跨层 TPID

pairwise 方法：

$$
D_i(t)=\min\left\{
\frac{1}{N-1}\sum_{j\ne i}I(U_i(t),U_j(t)),
\frac{1}{N-1}\sum_{j\ne i}I(U_j(t),U_i(t))
\right\}
$$

mean 方法：

$$
\bar U_{-i}(t)=\frac{1}{N-1}\sum_{j\ne i}U_j(t)
$$

$$
D_i(t)=\min\{I(U_i(t),\bar U_{-i}(t)),I(\bar U_{-i}(t),U_i(t))\}
$$

白话解释：

- pairwise：逐个和其他 layer 比。
- mean：先把其他 layer 平均成一个共同形状，再比较。
- 当前 Python 默认是 `method="mean"`。

### 5.4 时间自包含

先把上一时刻的 membership 按 median 位移对齐：

$$
\Delta_i(t)=median_i(t)-median_i(t-1)
$$

$$
\tilde U_i(t-1,y)=U_i(t-1,y-\Delta_i(t))
$$

然后计算：

$$
R_i(t)=\min\{I(U_i(t),\tilde U_i(t-1)),I(\tilde U_i(t-1),U_i(t))\}
$$

白话解释：

- 先把上一天的形状平移到今天 median 附近。
- 再看今天和昨天的形状是否互相包含。
- 这样不会因为整体水平上移/下移就误判为形状变化很大。

### 5.5 最终分数

$$
C_i=mean_t(D_i(t))
$$

$$
R_i=mean_t(R_i(t))
$$

$$
V_i=std_t(D_i(t))
$$

$$
Score_i=\lambda C_i+(1-\lambda)R_i-\beta V_i
$$

白话解释：

- \(C_i\)：跨层中心性。
- \(R_i\)：时间连续性。
- \(V_i\)：跨层中心性的波动程度。
- \(\lambda\)：中心性权重，代码默认 0.8。
- \(\beta\)：波动惩罚，代码默认 0.1。
- 分数越高，越应该靠近 streamgraph 中心。

为什么这么做：  
Python TPID 同时希望 layer “在群体中居中”和“随时间变化稳定”，并惩罚中心性忽高忽低的 layer。

---

## 6. Multiscale baseline：形式化定义

位置：`src/core/baseline/index.ts` 的 `computeMultiscaleDistributedBaseline`。

一句话：  
先用 SineStream 得到一个基线，再把基线中心线上的突然大跳动，用 Haar 多尺度基函数分散到多个时间尺度上。

### 6.1 基本对象

$$
h_i(t)=mean_i(t)
$$

$$
H(t)=\sum_i h_i(t)
$$

$$
b_0(t)=SineStreamBaseline(t)
$$

$$
c_0(t)=b_0(t)+\frac{1}{2}H(t)
$$

$$
d_0(t)=c_0(t)-c_0(t-1)
$$

白话解释：

- \(h_i(t)\)：第 \(i\) 个 layer 在时间 \(t\) 的厚度。
- \(H(t)\)：所有 layer 加起来的总厚度。
- \(b_0(t)\)：SineStream 给出的原始 baseline。
- \(c_0(t)\)：整条 stream 的中心线。
- \(d_0(t)\)：中心线从上一时刻到当前时刻移动了多少。

### 6.2 layer-slope signal

项目先构造一个“这里是不是变化剧烈”的时间信号：

$$
A(t)=\frac{\sum_i |h_i(t)-h_i(t-1)|}{\sum_i \frac{h_i(t)+h_i(t-1)}{2}+\varepsilon}
$$

$$
V(t)=|A(t)-A(t-1)|
$$

$$
S(t)=0.75\cdot norm(A(t))+0.25\cdot norm(V(t))
$$

白话解释：

- \(A(t)\)：所有 layer 在这个时间点变化了多少，再除以总体规模。
- \(V(t)\)：变化速度本身有没有突然改变。
- `norm`：把一串数缩放到 0 到 1。
- \(S(t)\)：综合信号。75% 看变化大小，25% 看变化是否突然。

### 6.3 Haar 多尺度分解

对 \(S(t)\) 做 dyadic Haar 分解。每一层把相邻块两两配对：

$$
a_{\ell+1,r}=\frac{a_{\ell,2r}+a_{\ell,2r+1}}{\sqrt{2}}
$$

$$
q_{\ell+1,r}=\frac{a_{\ell,2r}-a_{\ell,2r+1}}{\sqrt{2}}
$$

$$
E_\ell=\sum_r q_{\ell,r}^2
$$

$$
\lambda_\ell=\frac{E_\ell}{\sum_m E_m+\varepsilon}
$$

白话解释：

- \(\ell\)：尺度层级。尺度越大，看的时间范围越宽。
- \(a\)：平均信息，表示这一段大致有多高。
- \(q\)：细节信息，表示左右两半差多少。
- \(E_\ell\)：这一尺度上有多少变化能量。
- \(\lambda_\ell\)：这一尺度占总变化能量的比例。

选择规则：

$$
\mathcal{L}=\{\ell:\lambda_\ell \ge \theta\}
$$

如果没有任何尺度超过阈值，就选能量最大的那个尺度。代码最多保留 6 个尺度。

白话解释：

- \(\theta\)：`energyThreshold`，默认可由搜索给出。
- 这一步避免把所有尺度都加进去，只保留真正有变化的尺度。

### 6.4 每个尺度生成一个 shift basis

对每个选中的尺度 \(\ell\)，代码先得到 saliency：

$$
m_\ell(t)=0.5\cdot norm(|q_\ell| \text{ 展开到时间块})+0.5\cdot S(t)
$$

然后局部化中心线导数：

$$
r_\ell(t)=m_\ell(t)d_0(t)
$$

做滑动平均：

$$
\bar r_\ell(t)=MovingAverage(r_\ell, 2\cdot scale_\ell+1)
$$

得到导数修正：

$$
e_\ell(t)=\bar r_\ell(t)-r_\ell(t)
$$

积分成 baseline 位移基函数：

$$
\phi_\ell(t)=\sum_{\tau=1}^{t}s\cdot \left(e_\ell(\tau)-mean(e_\ell)\right)
$$

最后去掉 \(\phi_\ell\) 的平均值，让它不把整张图整体推上或推下。

白话解释：

- \(m_\ell(t)\)：这个尺度在这个时间点重要不重要。
- \(r_\ell(t)\)：把原中心线的突然移动只留在重要位置。
- \(\bar r_\ell(t)\)：把突然移动摊平到附近时间。
- \(e_\ell(t)\)：摊平后和原来之间的差，就是“应该怎么修正”。
- \(s\)：`strength`，控制修正力度。
- \(\phi_\ell(t)\)：这一尺度能提供的一条 baseline 调整曲线。

### 6.5 多尺度组合

$$
b(t)=recenter\left(b_0(t)+\sum_{\ell\in\mathcal{L}}\gamma_\ell\phi_\ell(t)\right)
$$

白话解释：

- \(b(t)\)：最终 multiscale baseline。
- \(\gamma_\ell\)：每个尺度的系数。
- `recenter`：重新居中，避免整条 stream 整体漂移。

代码用一个小网格搜索选择 \(\gamma_\ell\)：

$$
\gamma_\ell\in\{-1,-0.75,-0.5,-0.35,-0.2,-0.1,0,0.1,0.2,0.35,0.5,0.75,1\}
$$

### 6.6 优化目标

先定义几个指标。令第 \(k\) 个 layer 的中心线为：

$$
z_k(t)=b(t)+\sum_{r<k}h_r(t)+\frac{1}{2}h_k(t)
$$

主要指标：

$$
MeanSlope=mean_{k,t}|z_k(t)-z_k(t-1)|
$$

$$
MaxSlope=max_{k,t}|z_k(t)-z_k(t-1)|
$$

$$
Curvature=mean_{k,t}|z_k(t)-2z_k(t-1)+z_k(t-2)|
$$

中心线指标：

$$
CenterlineSlope=mean_t|c(t)-c(t-1)|
$$

$$
Burst=max_t|c(t)-c(t-1)|
$$

$$
Concentration=\frac{max_t|c(t)-c(t-1)|}{mean_t|c(t)-c(t-1)|+\varepsilon}
$$

白话解释：

- \(MeanSlope\)：平均线条倾斜程度，越低越平稳。
- \(MaxSlope\)：最陡的瞬间，越低越少突刺。
- \(Curvature\)：线条弯折程度，越低越平滑。
- \(Burst\)：中心线最大跳动。
- \(Concentration\)：跳动是不是集中在少数时刻。

用 \(x^0\) 表示 SineStream baseline 的原始指标，定义：

$$
ratio(x,x^0)=\frac{x}{|x^0|+\varepsilon}
$$

最终目标函数：

$$
\begin{aligned}
J=&0.25\,ratio(MeanSlope,MeanSlope^0)\\
&+0.60\,ratio(MaxSlope,MaxSlope^0)\\
&+0.55\,ratio(Curvature,Curvature^0)\\
&+0.45\,ratio(CenterlineCurvature,CenterlineCurvature^0)\\
&+1.15\,ratio(Burst,Burst^0)\\
&+0.80\,ratio(Concentration,Concentration^0)\\
&+0.12\,max(0,ratio(CenterlineSlope,CenterlineSlope^0)-1.8)^2\\
&+0.05\,BudgetRatio\\
&-0.35\,CoverageGain
\end{aligned}
$$

白话解释：

- \(J\)：越小越好。
- 前几项都是惩罚：斜率、最大斜率、弯折、突刺、集中度越大，惩罚越大。
- \(CenterlineSlope\) 只有超过原来的 1.8 倍才强惩罚。
- \(BudgetRatio\)：用了多少允许的位移预算，用太多会被罚。
- \(CoverageGain\)：中心线移动被摊到更多时间点上会加分，所以这里是减号。

验证条件：

$$
verified =
(\text{selected scales}\ge2)
\land
(\text{effective scales}>0)
\land
(J_{after}<J_{before})
\land
(\text{meanSlope guardrail passed})
$$

为什么这么做：  
SineStream 有时会把视觉运动集中在少数时间点，产生很陡的局部跳动。Multiscale baseline 的目标不是彻底改变图形，而是把这些局部爆发按多个时间尺度摊开，让整体更平顺，同时用 guardrail 避免全局可读性倒退。

---

## 7. 一个小例子

示例脚本：

```bash
python reports/0524/pid_multiscale_example.py
```

脚本会生成：

```text
reports/0524/pid_multiscale_example.png
```

图里有四部分：

1. 三个合成 layer 的中心线和不确定区间。
2. interval PID 的时间序列 depth 和平均分数。
3. contour PID-Mean 的 fuzzy mask 示例。
4. multiscale baseline 如何把中心线的局部突刺摊平。

读图方式：

- 如果一个 layer 的中心线经常落在其他 layer 的不确定区间里，它的 interval PID 分数会更高。
- fuzzy mask 越接近平均 mask，Contour PID-Mean 越高。
- multiscale 图中，绿色线比红色线更少尖锐突刺，表示移动被分散到了多个时间点。

---

## 8. 为什么项目要这样分成几版

1. Reference PID 数学最标准，但要求输入是概率 mask。
2. 当前 streamgraph 数据天然是时间序列和 quantile band，不天然是二维 mask。
3. Interval PID 很轻量，适合前端交互排序。
4. Contour PID 保留了 mask PID 的语义，适合做 contour boxplot。
5. Time-weighted / TPID 进一步考虑时间稳定性，避免只按平均中心性排序。
6. Multiscale 不解决排序问题，而解决 baseline 的运动分布问题：让流图更平滑、更少局部突刺。

