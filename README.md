# MaliciousFlow-Canva

用于加密货币资金流调查的本地 G6 画布。内置小型示例，可查看交易详情、筛选资金流、拖动节点和边、编辑备注、在报告和图之间定位证据。

## 启动

需要 Node.js 22 及以上版本。

```sh
npm ci
npm run dev
```

## 导入 KuCoin

在工具栏选择「导入案件」，打开 AML-Canva 的 `case/fund-flow-data.json`。可同时选择 KOL-001 v4 的 `build/report.json`，右侧显示报告章节和证据链接。核心视图默认打开，可切换全量视图。当前案件保存在浏览器的 IndexedDB，布局和备注保存在本地。选择「示例」返回内置小型样例。

## 验证

```sh
npm test
npm run build
npm exec playwright install -- chromium
npm run test:browser
```

要额外运行 KuCoin 实际数据的浏览器用例，设置以下本地路径变量。测试覆盖导入、核心与全量对账、证据定位和刷新恢复。

```sh
KUCOIN_CASE=/Shuxun/AML-Canva/case/fund-flow-data.json \
KUCOIN_REPORT=/Shuxun/TC-Linkage-Clues/KOL-reports/KOL-001-slowmist-kucoin-tc-2020/v4/build/report.json \
npm run test:browser
```

[产品计划与进度](docs/TODO/graph-canvas.md)
