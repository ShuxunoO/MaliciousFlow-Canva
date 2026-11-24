# MaliciousFlow-Canva

用于加密货币资金流调查的本地 G6 画布。内置小型示例，可查看交易详情、筛选资金流、拖动节点和边、编辑备注、在报告和图之间定位证据。

## 启动

需要 Node.js 22 及以上版本。

```sh
npm ci
npm run dev
```

## 导入 KuCoin

直接用浏览器打开工作区的 [KuCoin v4 离线画布](../exports/kucoin-v4-fund-flow.html)。在线工作台也支持通过「Import case」同时导入 AML-Canva 生成的 `fund-flow-data.json` 和 KOL-001 v4 的 `build/report.json`。界面使用英文，案件原文随报告导入。工作台将导入的案件保存在 IndexedDB，布局和备注存于浏览器。

默认打开「Core paths」。在「Network scope」切换全量、原图数据、公开回流及 D1–D8，按需开启历史与对照活动及交易标签。点地址或交易边可在画布右侧查看明细，点「Report」可以向右折叠或展开报告。明细中的证据链接会打开报告并定位对应证据。

各案件都可通过节点上的「Edit」同时编辑名称和备注。选中节点会高亮直接相连的交易线和地址。「Box select」支持拖出矩形选择多个地址。「Layers」可将节点、聚合边或明细中的单笔转账加入自定义图层。框选建层会加入框中节点和它们之间的转账。「Layout」可调整行距、列距及每列节点上限。图层和排版设置随案件保存在浏览器，并支持撤销。

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
