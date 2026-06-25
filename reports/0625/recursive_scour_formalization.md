# 0625 递归冲刷布局：形式化定义、算法说明与近似关系

## 一句话结论

递归冲刷布局把 streamgraph 中最容易误导读者的现象描述为一个明确的能量：**一个 layer 不应该因为别的 layer 变厚或变薄而被动上下移动，除非这种移动能换来更好的整体布局**。  

传统 centered stream、L2 wiggle、SineStream 都可以看作这个思想在更小搜索空间里的局部近似：它们通常只优化一条全局 baseline，或者只在固定 stack 中调 baseline；递归冲刷布局则进一步允许 layer group 被二叉拆分，放到局部支撑界面的两侧。

需要谨慎表述的是：  

- 对 L2 wiggle，可以在“固定顺序、固定单链、只允许一条 baseline 变化”的限制下给出比较严格的二次型推导。
- 对 centered stream，可以解释为“只保留总高度居中约束”的零阶近似，而不是严格的冲刷能量最优解。
- 对 SineStream，可以解释为“以感知误差为权重的局部冲刷代理目标”，但除非完全采用 SineStream 原论文的目标函数形式，否则不能声称严格等价。

## 1. 问题直觉

普通 streamgraph 会把多个 layer 堆在一起。如果底层 layer 在某个时间点突然变厚，那么上面的所有 layer 都会被抬高；如果底层 layer 变薄，上面的 layer 又会被压低。  

这个运动有时不是上层 layer 自己的数据变化导致的，而是由别的 layer 的厚度变化“传导”过来的。这里把这种传导叫作 **冲刷** 或 **被动迁移**。

本方法的目标是：  

1. 如果几个 layer 堆成一条普通链，就计算它们互相冲刷的代价。
2. 如果代价太高，就把这一组 layer 二分成两个 group，放到一个局部支撑界面的两侧。
3. 对每个 group 继续递归判断：继续堆成 chain，还是继续 split。
4. split 不是免费的，需要加入惩罚，避免退化成“每个 layer 一条独立 lane”。

## 2. 基本记号

设共有 `n` 个 layer，`T` 个时间点。第 `i` 个 layer 在时间 `t_k` 的厚度为：

```text
h_i(t_k) >= 0
```

对任意 layer 子集 `S`，定义 aggregate thickness：

```text
H_S(t_k) = sum_{i in S} h_i(t_k)
```

一阶时间差分：

```text
Delta H_S(t_k) = H_S(t_k) - H_S(t_{k-1})
```

二阶时间差分：

```text
Delta^2 H_S(t_k) = H_S(t_k) - 2 H_S(t_{k-1}) + H_S(t_{k-2})
```

一阶差分描述支撑界面的上下移动速度，二阶差分描述这种移动是否突然转向。

## 3. 单链冲刷能量

先考虑最普通的 stack。给定一个 layer 顺序：

```text
pi(1), pi(2), ..., pi(m)
```

第 `pi(r)` 个 layer 的支撑界面是它下面所有 layer 的总厚度：

```text
A_{pi(r)}(t_k) = sum_{q < r} h_{pi(q)}(t_k)
```

注意这里不包含 layer 自己的厚度。原因是：我们只惩罚“别人让它移动”，不惩罚“它自己变厚或变薄”。

迁移能量：

```text
E_move =
sum_{r,k} w_{pi(r),k} *
(
  sum_{q < r} Delta h_{pi(q)}(t_k)
)^2
```

转向能量：

```text
E_turn =
sum_{r,k} w_{pi(r),k} *
(
  sum_{q < r} Delta^2 h_{pi(q)}(t_k)
)^2
```

权重使用当前 layer 在相邻两个时间点的平均厚度：

```text
w_{i,k} = (h_i(t_{k-1}) + h_i(t_k)) / 2
```

单链总代价：

```text
E_chain(S) = E_move + lambda_turn * E_turn
```

直观解释：

- 如果一个很厚的 layer 被别的 layer 带着上下移动，代价更大。
- 如果支撑界面突然改变方向，代价更大。
- 如果某个 layer 是 chain 中第一个 layer，它的支撑界面是 0，因此它不会被别人冲刷。

## 4. 当前 chain 顺序的启发式

完整枚举所有 layer 顺序代价太高，所以当前实现先用稳定启发式决定 chain order。  

对每个 layer 计算自身 variation：

```text
V_i =
sum_k (Delta h_i(t_k))^2
+ lambda_turn * sum_k (Delta^2 h_i(t_k))^2
```

然后按 `V_i` 从小到大排序；如果相等，用原始 layer index 打破平局。

直觉是：变化更平稳的 layer 更适合放在支撑侧，变化更剧烈的 layer 放在外侧时，不会继续冲刷更多 layer。

## 5. 递归二叉目标

对任意 layer set `S`，定义最优代价：

```text
F(S) = min(
  E_chain(S),
  min_{empty != A subset S} F(A) + F(S \ A) + P(A, S \ A)
)
```

如果不 split，就把 `S` 作为一条普通 chain。  
如果 split，就把 `S` 分成 `A` 和 `B`，分别求解，再加 split penalty。

split penalty 为：

```text
P(A,B) =
rho_split
+ eta_height * E_height(A,B)
+ beta_balance * E_balance(A,B)
```

其中：

```text
E_height(A,B) = max_k H_A(t_k) + max_k H_B(t_k)
```

```text
E_balance(A,B) =
abs(mean(H_A) - mean(H_B)) / (mean(H_A) + mean(H_B) + epsilon)
```

这里 `epsilon = 1e-9`。

接受 split 的条件是严格的：

```text
F(A) + F(B) + P(A,B) < E_chain(S)
```

如果 split 后只是相等，或者更差，就保留普通 chain。这样可以避免过度拆分。

## 6. 树结构

求解结果是一棵二叉树：

```text
ScourTree =
  leaf(layers, order, cost)
| chain(layers, order, cost)
| split(layers, left, right, cost)
```

含义：

- `leaf`：单个 layer，是退化的 chain，cost 为 0。
- `chain`：多个 layer 仍按普通 stack 渲染。
- `split`：当前 group 被拆成左右两个 group，分别放在局部支撑界面的两侧。

当前实现还做了一个规约：因为最大递归深度会影响一个子问题还能不能继续 split，所以 memo key 中除了 sorted group key，还包含 remaining depth。否则同一个 group 在浅层算出的深树，可能被错误复用到深层，突破 `maxDepth` 限制。

## 7. candidate split 的生成

完整目标需要枚举所有非空真子集，但大 group 会指数爆炸。当前采用两种模式。

exact 模式：

```text
if group.length <= 12 and searchMode == "exact":
  enumerate all non-empty proper subsets
  remove A|B and B|A duplicates
```

现在的实现会固定排序后 group 的第一个 layer 必须在 left subset 中，因此每个无序二分只出现一次。两层 group 只会产生一个 split 候选。

greedy 模式：

1. 按 variation score 排序，中位数二分。
2. 按平均厚度排序，中位数二分。
3. 按峰值时间排序，中位数二分。
4. 选变化最大的少数几个 layer，尝试 one-vs-rest。
5. 用固定 seed 生成少量 balanced random splits。

所有 greedy 候选也按集合去重，保证确定性。

## 8. 渲染：从树到多边形

每个节点都有一个局部支撑界面。  

对 chain 节点：

如果从界面向上生长：

```text
lower_i(t) = R(t) + prefix_i(t)
upper_i(t) = R(t) + prefix_i(t) + h_i(t)
```

如果从界面向下生长：

```text
upper_i(t) = R(t) - prefix_i(t)
lower_i(t) = R(t) - prefix_i(t) - h_i(t)
```

对 root split：

- left child 放在根支撑界面上方。
- right child 放在根支撑界面下方。

对 nested split，不能简单地继续共用父节点界面，否则子树中朝反方向生长的部分会跨回父节点另一侧，和兄弟 group 重叠。  

当前实现的处理是：

- 如果一个 split 子树已经被分配到父节点上方，就先把它自己的局部界面向上平移一段，使它的下侧 child 正好贴在父节点界面之上。
- 如果一个 split 子树已经被分配到父节点下方，就先把它自己的局部界面向下平移一段，使它的上侧 child 正好贴在父节点界面之下。

这样可以保证整个子树留在父节点给它分配的半侧空间里。最后只做一个全局常数平移来居中，不对每个时间点单独居中，因此根支撑界面仍然是一条水平线。

## 9. 两层例子

设 orange 在 `t=3` 附近有峰，green 在 `t=5` 附近有峰。  

如果二者堆成普通 chain，那么后放的 layer 会被先放 layer 的峰值抬动，产生较大支撑界面迁移能量。  

如果 split：

- orange 从共同支撑界面向上生长。
- green 从共同支撑界面向下生长。
- 二者的支撑界面都是根界面，近似不被对方冲刷。

只要 `rho_split` 不过大，就会有：

```text
E_split < E_chain
tree.type == "split"
```

当前自检中，两层错峰例子的结果是：

```text
chainCost = 11.916
splitCost = 0.01
tree.type = "split"
```

## 10. 与 centered stream 的关系

centered stream 的核心公式通常是：

```text
b(t) = -0.5 * H_all(t)
```

也就是把整个 stream 的总高度上下对称放置，让整体视觉中心在 0 附近。

从冲刷角度看，centered stream 做了一个非常强的限制：

1. 不允许改变 layer 间的拓扑结构。
2. 不允许 split。
3. 只允许一条全局 baseline `b(t)` 移动。
4. 目标不是直接最小化每个 layer 的支撑界面迁移，而是让整体 envelope 上下平衡。

如果把所有 layer 看成一个 aggregate band，高度为 `H_all(t)`，要求上下边界相对中心对称：

```text
lower(t) = -0.5 H_all(t)
upper(t) =  0.5 H_all(t)
```

那么 centered stream 就是这个“只看总高度、不看内部冲刷”的解析解。

所以它可以看作递归冲刷目标的零阶近似：

- 递归冲刷关心每个 layer 的局部支撑界面。
- centered stream 只关心总 aggregate 的中心。
- 当所有内部 layer 的冲刷差异被忽略时，centered stream 就是最简单的全局平衡解。

严格结论：

```text
centered stream 不是 E_chain 或 F(S) 的严格最优解；
它是忽略内部支撑界面后，对总高度做中心对称约束得到的弱近似。
```

## 11. 与 L2 wiggle 的关系

L2 wiggle 更接近冲刷目标，可以给出较严格的局部推导。

固定 layer 顺序，不允许 split。设第 `r` 个 layer 的中心线为：

```text
C_r(t) = b(t) + prefix_r(t) + 0.5 h_r(t)
```

其中：

```text
prefix_r(t) = sum_{q < r} h_q(t)
```

L2 wiggle 通常最小化中心线斜率的平方和：

```text
J_L2(b) = sum_{r,k} alpha_{r,k} *
(
  Delta b(t_k)
  + Delta prefix_r(t_k)
  + 0.5 Delta h_r(t_k)
)^2
```

对每个时间差分点，把 `Delta b(t_k)` 当成未知数。令：

```text
u_{r,k} = Delta prefix_r(t_k) + 0.5 Delta h_r(t_k)
```

则：

```text
J_L2 = sum_r alpha_{r,k} * (Delta b_k + u_{r,k})^2
```

对 `Delta b_k` 求导并令其为 0：

```text
2 sum_r alpha_{r,k} * (Delta b_k + u_{r,k}) = 0
```

得到：

```text
Delta b_k =
- sum_r alpha_{r,k} u_{r,k}
/ sum_r alpha_{r,k}
```

这说明 L2 wiggle 的 baseline 变化，是所有 layer 局部运动项的加权平均反向抵消。

再看冲刷单链目标。如果固定顺序、固定 chain、只允许全局 baseline `b(t)` 移动，则每个 layer 的支撑界面可以写成：

```text
A_r(t) = b(t) + prefix_r(t)
```

只保留一阶项时：

```text
J_scour(b) =
sum_{r,k} w_{r,k} *
(
  Delta b(t_k) + Delta prefix_r(t_k)
)^2
```

这和 L2 wiggle 是同型二次优化问题，只是 L2 用的是 layer center，冲刷用的是 support interface。二者的一阶最优条件完全同型：

```text
Delta b_k =
- sum_r w_{r,k} Delta prefix_r(t_k)
/ sum_r w_{r,k}
```

如果加入二阶 turning term：

```text
lambda_turn * sum_{r,k} w_{r,k} *
(
  Delta^2 b(t_k) + Delta^2 prefix_r(t_k)
)^2
```

目标仍是关于 `b(t)` 的二次型，只是从逐点闭式解变成一个带时间平滑耦合的线性系统。

严格结论：

```text
在固定顺序、固定单链、不允许 split、只优化一条 baseline 的限制下，
L2 wiggle 可以看作冲刷能量的一种局部二次近似。
区别在于 L2 优化 layer center，递归冲刷优化 support interface。
```

## 12. 与 SineStream 的关系

SineStream 的目标更偏感知：它关心读者是否会把一个 layer 的边界弯曲误读成该 layer 自身的厚度变化，也就是 sine illusion。  

从冲刷角度解释，sine illusion 往往来自类似现象：

```text
某个 layer 的边界在动，
但这个动不是它自己的厚度变化造成的，
而是别的 layer 或 baseline 造成的。
```

因此，SineStream 和递归冲刷布局在直觉上是一致的：都想降低“外部因素造成的被动运动”。

可以写成一个条件性近似。假设 SineStream 的局部感知损失可以二次近似为：

```text
J_sine =
sum_{r,k} gamma_{r,k} *
(
  Delta A_r(t_k)
)^2
```

其中 `gamma_{r,k}` 是由 sine illusion 感知模型给出的权重。  

而单链冲刷的一阶目标是：

```text
J_scour =
sum_{r,k} w_{r,k} *
(
  Delta A_r(t_k)
)^2
```

二者形式相同，区别在权重：

- 冲刷目标的权重主要来自 layer 厚度。
- SineStream 的权重来自感知误差或 illusion 风险。

如果 SineStream 每一步只在固定顺序和固定 baseline 参数化下做局部优化，那么它可以看作：

```text
使用感知权重 gamma 的局部冲刷代理目标。
```

但这里不能声称严格证明等价，原因是：

1. SineStream 的原始目标可能不是完整的二次型。
2. SineStream 通常不显式构造递归 split tree。
3. SineStream 主要在固定或局部可变 baseline 上做优化，而递归冲刷还优化 group topology。

谨慎结论：

```text
SineStream 是递归冲刷思想的感知加权局部近似，而不是严格特例。
如果把 SineStream 的局部 illusion loss 二次化，它与冲刷能量共享同一个
"减少被动支撑界面运动" 的数学骨架。
```

## 13. 三类旧方法与递归冲刷的统一视角

可以把所有方法放进同一个大框架里：

```text
minimize support/interface motion
subject to different layout freedoms
```

对比：

```text
centered stream:
  only total height is considered;
  one analytic centered baseline;
  no layer-level support cost.

L2 wiggle:
  fixed stack topology;
  one global baseline;
  quadratic local slope objective.

SineStream:
  fixed or locally adjusted baseline;
  perceptual weights for sine illusion;
  local surrogate of passive motion.

recursive scour:
  binary tree topology;
  local support interfaces;
  explicit split penalty;
  direct cost for passive support migration.
```

所以汇报时可以这样说：

> 以前的方法主要是在固定 stack 中寻找一条更好的 baseline。我们的递归冲刷方法把 baseline 优化推广为局部支撑界面的树结构优化：当单链会让 layer 被严重冲刷时，就允许这一组 layer 分裂到界面的两侧；当分裂收益不足以抵消惩罚时，就保留普通 stack。

## 14. 当前实现状态

当前 `src/core/temp` 已经按这个定义规约：

1. `chainCost` 只使用 prefix layer 的变化，不包含 layer 自己的厚度变化。
2. 单层 group 返回 `leaf`。
3. 多层 terminal group 返回 `chain`。
4. split node 是严格二叉结构。
5. exact split 去掉了 `A|B` 和 `B|A` 对称重复。
6. greedy split 是 deterministic 的。
7. memo key 包含 sorted group 和 remaining depth，避免突破 `maxDepth`。
8. nested split 渲染时会先把子树整体放进父节点的一侧，避免跨侧重叠。

## 15. 局限与下一步

当前版本仍是 first implementation，不应过度包装成完整最优算法。

主要局限：

1. chain order 只是 variation heuristic，不是全排列最优。
2. greedy mode 只生成有限 split 候选，不能保证全局最优。
3. split penalty 的参数需要实验校准。
4. nested split 的屏幕嵌入会引入父级约束下的平移；局部冲刷能量仍按 local baseline 计算。这是为了避免 overlap 的工程折中。
5. 目前目标主要处理时间方向的一阶/二阶被动迁移，还没有直接加入颜色、遮挡、标签可读性等视觉项。

建议下一步：

1. 在 synthetic two-layer、three-layer nested split、真实数据上分别记录 `E_chain`、`E_split`、tree depth。
2. 把 split penalty 做成可解释参数扫描，找出“不过度拆分但能拆开明显冲刷”的区间。
3. 如果需要更强理论，可以把 L2/SineStream 都写成固定拓扑下的二次 surrogate，然后把递归 split 解释为从连续 baseline 优化推广到离散树拓扑优化。
