# Agent 接口

画布公开同源页面内的 `window.maliciousFlow`。宿主可以通过当前页面的 JavaScript 调用这些命令。应用自身使用同一套案件状态和分析提交逻辑。

## 调查数据源

默认通过 Blockscout Ethereum 主网 v2 接口获取数据。可用 `VITE_BLOCKSCOUT_URL` 指定兼容的 HTTPS 服务地址。地址调查采集原生余额及近期已确认、有金额的 ETH 和 ERC-20 转账，每类最多读取两页。交易哈希调查采集成功的原生 ETH 转账和 ERC-20 日志。采集以当前调查起点为范围，内部调用、NFT、非 Ethereum 链和跨跳追踪尚未接入。估值凭据来自数据源现有报价，转账仅在数据源提供历史汇率时计算 USD。规则化分析按资产分别汇总并生成引用。

## 分批写入

`apply_analysis(batch)` 校验并保存分析结果，完成图更新后返回回执，同时在 `#app` 触发 `flow:analysis` 事件。

| 字段 | 约定 |
| --- | --- |
| `schemaVersion` | 当前为 1 |
| `caseId` | 当前案件 ID |
| `expectedRevision` | 从视图读取的当前分析版本 |
| `requestId` | 每次新提交使用唯一字符串，重试使用原请求 ID 及相同完整请求 |
| `addresses` | 地址记录数组，字段为 `id`、`address`、`name` |
| `transfers` | 事件记录数组，提供稳定的 `id`、`source`、`target`、`hash`、`time`、`asset`、`assetId`、`amount` 和来源数组 `sources` |
| `balances` | 可选快照数组，每项含 `addressId`、`assetId`、`asset`、`amount`、`time`、`source` 及可选的 `usd` |

金额用十进制字符串，时间使用带时区的 ISO 8601 字符串。ERC-20 事件 ID 包含链、交易哈希和日志位置。回执含 `revision`、`added`、`duplicates` 和 `refs`。相同请求返回原回执。旧版本、缺少来源和冲突事件均会报错，批次会整体拒绝。

```js
const api = window.maliciousFlow
const { caseId, revision } = await api.set_view()
const receipt = await api.apply_analysis({
  schemaVersion: 1,
  caseId,
  expectedRevision: revision,
  requestId: crypto.randomUUID(),
  addresses: [{ id: "eth:example", address: "0x0000000000000000000000000000000000000001", name: "示例地址" }],
  transfers: []
})
console.log(receipt.revision, receipt.refs)
await api.set_view("eth:example")
```

## 视图与编辑

| 调用 | 行为 |
| --- | --- |
| `set_view()` | 返回当前案件、版本、选择、筛选及可见规模 |
| `set_view(ref)` | 定位地址、实体、事件 ID 或证据编号 |
| `set_view({ ref, filters })` | 更新筛选并按需定位。筛选可提供 `asset`、`from`、`to`、`address`、`core`，时间窗口为左闭右开 |
| `edit_canvas({ action, ... })` | 可执行 `rename` 和 `note`（`id`、`text`）、`move`（`id`、`position`）、`bend`（`id`、`offset`）及 `undo`、`redo` |
| `edit_entity({ name, members })` | 生成实体归属预览。用户在浮窗确认后应用 |
| `edit_report({ text, refs, chapter })` | 保存经引用校验的草稿。目标章节可省略。用户可在报告中预览并确认结论 |

## 验证

`npm test` 校验分页、精度、版本冲突、去重及回执重放。Chromium 回归模拟确定的提供方响应，覆盖采集两批、折叠浮窗、生成草稿、实体确认和刷新恢复。通过 `FLOW_LIVE_BLOCKSCOUT=1 npm run test:browser -- agent.spec.ts` 可额外查询一笔历史 Ethereum 交易。

[Blockscout v2 数据接口](https://github.com/blockscout/blockscout-api-v2-swagger/blob/main/swagger.yaml)
