# AML-Canva 图标库

446 个 Web3 / DeFi 品牌图标，**每个图标同时提供 SVG 与 PNG（256×256, RGBA）**，用于资金流图、报告、画布和网页。

生成时间：2026-11-17。可直接打开 [`preview.html`](preview.html) 离线浏览全部图标。

## 目录

```
icons/
├── protocols/         161  DeFi 协议
│                        DEX 29 · Lending 24 · Bridge 22 · Yield 17
│                        Derivatives 16 · CDP 12 · Liquid Staking 8
│                        RWA 8 · Prediction 6 · Privacy 5
│                        Restaking 5 · Options 5 · Liquid Restaking 4
├── chains/             83  公链 / L2 / 应用链
├── tokens/            107  常用代币、稳定币、 LST
├── wallets/            35  钱包与托管
├── exchanges/          31  中心化交易所
├── infra/              29  Web3 基础设施（预言机、RPC、浏览器、数据、安全）
├── preview.html            离线图标总览
├── contact-sheet-*.png     分类预览大图
├── manifest.json           全量索引（名称、来源、许可、SVG 类型）
└── _meta/
    ├── validation.json     文件成对、尺寸、空图、孤儿文件校验
    └── missing.json        未收录清单及原因
```

## 文件命名与格式

- 路径：`<category>/<slug>.svg` 与 `<category>/<slug>.png`
- 同一 slug 的 SVG / PNG 一一对应；PNG 为 256×256 RGBA，等比缩放后居中，四周透明留白。
- 代币使用小写 symbol 作 slug（`usdc`、`wsteth`、`cbbtc`）；协议/钱包/交易所使用 kebab-case（`pancake-swap`、`wallet-connect`）。
- `manifest.json` 每条记录包含：`category / name / slug / group / svg / png / source / source_url / license / svg_kind / png_kind`。

## 图标来源与许可

| 来源 | 图标数 | 许可 | 说明 |
| --- | ---: | --- | --- |
| [@web3icons](https://github.com/0xa3k5/web3icons) | 138 | MIT | 代币、网络、钱包、交易所；彩色 SVG |
| [DefiLlama Icons CDN](https://icons.llamao.fi/) | 111 | 无明确开源许可 | DeFi 协议、CEX、部分基础设施；位图转 SVG |
| [LXDAO Web3Logo](https://web3logo.lxdao.io/) | 70 | 站点未标许可 | 中文/亚洲项目、部分协议与代币 |
| [aave-dao/web3-icons](https://github.com/aave-dao/web3-icons) | 48 | MIT | 代币、网络、钱包；SVG |
| [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) | 43 | CC0-1.0 | 主流代币；彩色 SVG |
| [Simple Icons](https://simpleicons.org/) | 8 | CC0-1.0 | 基础设施单色图标，已按品牌色上色 |
| 官方品牌资源 | 9 | 各自商标 | Etherscan、Hardhat、Foundry、Blockscout、QuickNode、TRM Labs、Chainalysis、Viem、Infura |
| CoinGecko 图片 CDN | 1 | 项目商标 | Wormhole |
| 跨类复用（copy） | 18 | 随目标图标 | 例如 ENA 使用 Ethena 品牌图，TON/INJ 使用链图标 |

上表除最后一行外均为“直接来源”计数（LXDAO 70 = 65 个矢量 + 5 个位图），copy 行为跨类复用条目，合计 446。

> **MIT / CC0 只覆盖图标文件本身，不等于 logo 商标授权。** DefiLlama、LXDAO、CoinGecko 没有明确的开源许可；对外发布或商用前请逐个确认项目品牌规范。

## SVG 类型

`manifest.json` 的 `svg_kind` 字段：

| 值 | 数量 | 含义 |
| --- | ---: | --- |
| `vector` | 309 | 真矢量 SVG |
| `mono-vector` | 8 | Simple Icons 单色矢量，已上品牌色 |
| `traced` | 109 | 从 512px 位图用 vtracer 矢量化；细节可能略有差异 |
| `embedded-raster` | 20 | SVG 内嵌 PNG，保留透明背景；可当单文件使用，但不能无限放大 |

优先使用 `vector` / `mono-vector`。`traced` 适合图标尺寸（≤128px）使用；`embedded-raster` 用于必须保留透明背景或复杂渐变的情况。

## 用法

HTML / 报告：

```html
<img src="assets/icons/protocols/aave.svg" width="32" height="32" alt="Aave">
<img src="assets/icons/chains/ethereum.png" width="32" height="32" alt="Ethereum">
```

G6 / 画布节点（把节点的 image src 指向 PNG；导出 SVG 时改用 SVG）：

```js
{
  id: 'aave',
  style: {
    type: 'image',
    src: 'assets/icons/protocols/aave.png',
    size: 36
  }
}
```

Python：

```python
from PIL import Image
im = Image.open('assets/icons/chains/solana.png')  # 256x256 RGBA
```

所有文件都在本地，不依赖 CDN，适合离线 HTML 与打包分发。若报告查看环境会拦截外部资源，直接使用相对路径引用本目录即可。

## 查询示例

```python
import json
m = json.load(open('assets/icons/manifest.json'))
for x in m['icons']:
    if x['category'] == 'protocols' and x['group'] == 'Lending':
        print(x['name'], x['svg'], x['svg_kind'])
```

## 未收录（22）

| 类别 | 名称 | 原因 |
| --- | --- | --- |
| protocols | OpenOcean、Karak、Portal | 没有可靠矢量源；Portal 与同名游戏代币冲突 |
| wallets | Web3Auth、Fireblocks、Copper、Fordefi | 无公开可用的品牌源 |
| tokens | bSOL | 无独立品牌图 |
| infra | UMA、Tellor、Dune、Nansen | 源匹配到错误项目或没有可靠资源 |
| infra | Moralis、Tenderly、DefiLlama、CoinGecko、MetaSleuth、Space ID、Unstoppable Domains、Elliptic、SlowMist、PeckShield | 官网/GitHub 未提供可直接引用的 SVG/PNG |

如需补齐，建议从各项目官网的 brand / press kit 获取官方矢量文件；不要用 favicon 放大代替。

## 校验

`_meta/validation.json` 当前结果：

- 446 个 manifest 条目
- 0 个缺失文件、0 个尺寸错误、0 个空图、0 个孤儿文件
- 所有 PNG 均为 256×256 RGBA

## 版权

图标版权归各自项目所有。本目录只做聚合与格式统一，不改变原始图形。`manifest.json` 为每个图标保留了 `source` 与 `source_url`，便于回溯。若需公开再分发，请先核对上表中的许可与项目品牌条款。
