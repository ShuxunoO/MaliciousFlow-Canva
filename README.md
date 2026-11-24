# MaliciousFlow-Canva

用于加密货币资金流调查的本地 G6 画布。内置小型示例，可查看交易详情、筛选资金流、拖动节点和边、编辑备注、在报告和图之间定位证据。

## 启动

需要 Node.js 22 及以上版本。

```sh
npm ci
npm run dev
```

## 案件工作台

「Saved Charts」每个案件显示一行，支持按标题、地址和交易哈希搜索。通过「New Chart」创建空白案件，或从列表打开、重命名和删除已有案件。旧版保存在当前浏览器的案件会迁移到列表。

在画布中点击「Save」提交当前案件的人工修改。浏览器保留待保存的编辑草稿，出现保存失败提示后可重新点击「Save」。选中节点或边可在详情中调整颜色或恢复默认值，配色随画布一起保存。拖动 Agent 标题栏的点阵手柄或星形按钮可移动整个浮窗。收起后仍可拖动星形按钮，点击星形按钮可展开或收起。两个手柄聚焦后都支持方向键移动。文件与图像、会话新建和历史搜索已预留界面入口与接口。

## 导入 KuCoin

直接用浏览器打开工作区的 [KuCoin v4 离线画布](../exports/kucoin-v4-fund-flow.html)。在线工作台也支持通过「Import case」同时导入 AML-Canva 生成的 `fund-flow-data.json` 和 KOL-001 v4 的 `build/report.json`。界面使用英文，案件原文随报告导入。案件与显式保存的编辑存入 IndexedDB，待保存草稿由浏览器本地存储恢复。

可从离线归档安装 KuCoin 的交易和报告数据。工作台会在首页恢复缺失的 KuCoin 条目，已有案件及其编辑优先保留。浏览器按访问的协议、主机名和端口保存人工编辑。

```sh
python3 scripts/install-kucoin.py ../exports/kucoin-v4-fund-flow.html
```

默认打开「Core paths」。在「Network scope」切换全量、原图数据、公开回流及 D1–D8，按需开启历史与对照活动。每条交易边均显示摘要，线旁空间不足时用细引线连接到附近空位。点地址或交易边可在画布右侧查看明细，点「Report」可以向右折叠或展开报告。明细中的证据链接会打开报告并定位对应证据。

同一对地址的多条交易边沿独立水平线槽展示。点击交易线后选择「Focus address pair」，可单独查看两端之间的双向交易，并在边明细中核对精确金额、UTC 时间和逐笔证据。

各案件都可通过节点上的「Edit」同时编辑名称和备注。选中节点会高亮直接相连的交易线和地址。「Box select」支持拖出矩形选择多个地址。「Layers」可将节点、聚合边或明细中的单笔转账加入自定义图层。框选建层会加入框中节点和它们之间的转账。「Layout」可调整行距、列距及每列节点上限。图层和排版设置随案件保存在浏览器，并支持撤销。

画布按同一套规则处理所有案件的排版、走线、摘要和校验。「Layout」中可查看最近一次绘制的校验结果。

如需生成离线画布，先用同一版 KOL-001 v4 输入生成 AML-Canva 图数据，再构建应用并打包。打包脚本按 SHA-256 核对报告版本。

```sh
npm run build
python3 scripts/package-kucoin.py /path/to/fund-flow-data.json /path/to/v4/build/report.json kucoin-v4-fund-flow.html
```

## 验证

```sh
npm test
npm run build
npm exec playwright install -- chromium
npm run test:browser
```

要额外运行 KuCoin 实际数据的浏览器用例，设置以下本地路径变量。测试覆盖 12 个视图对账、历史活动筛选、证据定位、右侧明细、报告折叠和离线打开。

```sh
KUCOIN_CASE=/Shuxun/AML-Canva/case/fund-flow-data.json \
KUCOIN_REPORT=/Shuxun/TC-Linkage-Clues/KOL-reports/KOL-001-slowmist-kucoin-tc-2020/v4/build/report.json \
KUCOIN_OFFLINE=/Shuxun/exports/kucoin-v4-fund-flow.html \
npm run test:browser
```

[产品计划与进度](docs/TODO/graph-canvas.md)

## 在线调查与 Agent 接口

「New investigation」打开空白 Ethereum 案件。输入地址或交易哈希后选择「Collect and plot」，结果会分批写入。选择 Upstream 或 Downstream 可追踪 1–3 跳。可以折叠浮窗继续浏览画布，也可以停止当前查询，已写入的结果保留。配置 `VITE_BLOCKSCOUT_URL` 可指定一个兼容 Blockscout v2 且允许浏览器跨域访问的 Ethereum 数据服务。

[Agent 接口、数据覆盖和接入示例](docs/agent-api.md)

[分析批次与余额快照 JSON Schema](docs/schemas/analysis-batch.schema.json)

[KuCoin 实绘几何验收与复现步骤](docs/layout-verification.md)
