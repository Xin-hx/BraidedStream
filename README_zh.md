# BraidedStream：分类时间序列集合分布的河流图

[English](README.md)

本项目以河流厚度表达代表值，通过空间扩展和几何形变表达分布的偏态、多峰等特征。算法与可视化封装为独立的 TypeScript + D3 package；交互前端使用 Vue 3，包本身不依赖 Vue。

## 启动与验证

使用 Node 26+，或满足所安装 jsdom 要求的 Node 版本，以及 npm：

```sh
npm install
npm run dev
```

打开终端显示的 Vite 地址。页面包含 Illustration、COVID 两个公开案例；本地存在私有文件时，开发模式额外提供 TCM 案例。支持可视化模式、基线、KDE 带宽、轮廓与密度编码、时间筛选和 SVG 下载。图例支持排序、选层和配色，配色保存在当前浏览器。

```sh
npm test
npm run test:package
npm run build
npm run preview
```

构建依次完成独立包输出、TypeScript/Vue 类型检查和前端打包，生产产物仅包含 Illustration 和 COVID 公开数据，不包含 TCM。`test:package` 会在临时独立项目中安装打包产物，验证运行和严格 NodeNext 类型检查。

点击 **Import your data** 可在浏览器内导入 CSV、XLSX 或 JSON：选文件 → 预览并映射字段 → 校验摘要 → 导入图表。支持工作表和表头选择、三种表格布局、权重与空值处理，以及统一 JSON 模板与导出。解析和自定义数据计算使用可取消的 Web Worker，并显示实际进度或等待圈；不会上传文件，也不会持久保存导入数据，刷新或点击 Remove data 即清除。格式和限制详见[导入说明](docs/data-import.md)。

可用多个分组字段确定每个分布、多个成员字段确定 ensemble 样本身份；也可映射“数值＋质量／频数”或“区间上下界＋质量／频数”导入已聚合分布。确认页显示实际分组规则、分布数量和每个分布的成员数。

## 独立调用

```ts
import { select } from 'd3';
import { braidedStream, streamTimeFilter } from 'braided-stream';
import { runPipeline, type InputDataset } from 'braided-stream/core';
import 'braided-stream/style.css';

const dataset: InputDataset = {
  times: ['t1', 't2'],
  layers: [{ id: 'A', measures: [
    { components: [{ kind: 'atom', value: 2, mass: 1 }] },
    { components: [{ kind: 'uniform', low: 1, high: 5, mass: 1 }] },
  ] }],
};
const result = runPipeline(dataset, { braided: { bandwidthRatio: 0.3 } });
const prepared = { dataset, result };
const chart = braidedStream()
  .options({ width: 1180, height: 620 })
  .on('hover.app', event => { /* 用事件数据展示 tooltip */ })
  .on('leave.app', () => { /* 隐藏 tooltip */ });

const main = select(svg).datum(prepared);
main.call(chart);
const filter = streamTimeFilter().on('rangechange.app', ({ start, end }) => {
  main.call(chart.options({ start, end }));
});
select(filterSvg).datum(prepared).call(filter);

// 卸载时清理 D3 节点和监听器：
chart.destroy(main);
filter.destroy(select(filterSvg));
```

也可直接把 `InputDataset` 绑定到主图，由包计算结果。传入预计算结果时，切换配色、显示选项和时间窗口不会重新计算算法。时间窗口为包含两端的索引区间；`null` measure 表示缺失观测。

Vis method 提供 `Streamgraph` 基础色带和 `Braided stream` 编织分支两种模式；基础版使用 `.options({ visMethod: 'streamgraph' })`。密度渐变、分支描边和时间截面仅用于编织模式。

包输出 ESM、TypeScript 声明和图表 CSS，D3 7 为 peer dependency：

```sh
npm run build:package
npm pack --workspace braided-stream
# 在其他项目中：
npm install /path/to/braided-stream-0.1.0.tgz d3@^7.9.0
```

完整输入格式、配置项、事件、底层绘制入口及 Vue 接入方式见 [package 文档](packages/braided-stream/README.md)。以上命令不会发布 npm。

## 代码边界

- `packages/braided-stream/`：输入验证、算法、SVG 绘制、悬停命中、时间刷选及图表样式；不依赖 Vue 或 demo。
- `app/`：Vue 组件、数据加载、tooltip、图例与配色持久化、文件下载。
- `examples/converters/`：案例转换器和业务元信息。
- `examples/data/`：示例源数据。
- `scripts/figures/`：使用独立包的论文图表生成脚本。
- `docs/`：文档图片与报告。
- `artifacts/`：不提交的生成产物和本地备份。
- 测试跟随 app/package 放置；`tests/integration/` 存放跨模块回归、数据边界和独立安装验证。

Vue 只管理 SVG 宿主，D3 管理其内部图表节点；大型计算结果使用浅响应式引用。需要其他框架时，直接复用同一个 package 即可。

## 论文图表

在仓库根目录执行：

```sh
npm run build:package
npm run figures:covid
npm run figures:tcm
npm run typecheck
```

生成文件写入 `artifacts/figures/`。脚本使用包的底层绘制入口，不引用 demo UI。TCM 与 COVID 案例描述观测或模型分布，不构成因果效果的证据。

## TCM 数据仅限本地

将有权使用的真实记录放在 `examples/data/private/TCMRecord.csv`。整个私有目录及所有 `TCMRecord.csv` 文件名均被 Git 忽略。不要复制到公开静态资源中，也不要使用强制添加绕过忽略规则。

开发服务器绑定本机地址，仅对本机请求提供数据，并阻止直接通过文件系统 URL 读取。生产构建始终隐藏 TCM 选项，且不复制真实数据。没有私有文件的环境仍能构建和测试，真实 TCM 检查自动跳过，人工构造的转换器测试照常运行。TCM 导出图及样本 CSV 只写入忽略的 `artifacts/figures/`。详见[数据说明](examples/data/README.md)。
