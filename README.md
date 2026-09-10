# Uncertainty-Aware Braided Streamgraph Demo

可运行的 TypeScript + D3 layer-slot 原型：TPID 决定层序，不确定性决定每层额外空间，连续一维 distributional grouping 决定 `K=1/2/3` 的同色分支拓扑。方法与守恒关系见 [METHOD.md](METHOD.md)。

## 运行

```bash
npm install
npm test
npm run dev       # http://localhost:5173/
npm run build     # 静态产物到 dist/
```

首页包含 editable、TCM 和 COVID trained-ensemble case study。可切换 wiggle/sine baseline、代表分位数、envelope 分位数、top-p exposure、平滑轮廓与 slot debug 边界。

## 代码结构

```text
code/
  data/                # COVID、TCM、editable adapters 与输入规范化
  engine/              # quantile 校验、TPID、KDE、baseline、layout、costs
  index.ts             # 稳定 pipeline 入口
  types.ts             # 共享数据与几何类型
demo/
  main.ts, render.ts, style.css
tests/
  helpers/             # test-only synthetic generator
  braided.test.ts      # 分支、持久化、守恒、权重与预算性质
```

## 语义边界

- `0` 是有效样本；非有限值才表示缺失。TCM 的 `patient sample=0` bin 保留空样本审计信息，但 representative value 固定为 `0`。
- quantile knots 按概率区间宽度加权，不视为等权样本。
- `K`、分支质量与 mode 位置由 distribution shape 独立决定；不确定性 percentile rank 只控制总空白。
- 彩色总厚度始终等于代表分位数；mode 间的内部 gaps 总和等于 exposure 预算后的不确定性空间。
- envelope 是用户选择的上分位数（默认 Q90），定义最大空间预算，不是 Q2.5–Q97.5 predictive interval。
- 这是视觉布局，不是物理河流模拟。
