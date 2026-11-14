# dsh-bot-team-tab

侧栏「团队」页：把本机每个 DS Bot 现在在干什么、卡在哪、谁在等它，摊成一屏能看完的列表。点一行就跳到那个 Bot 的会话。

给 [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) 加一个 Tab，配合 [ds-bot](https://www.npmjs.com/package/ds-bot) 使用。纯客户端插件：没有宿主工具、没有 HTTP 路由、不写 DS Bot 的任何数据。

## 它是什么

- 一屏 6–7 个 Bot，按 DS Bot 的分组排列，组内按「等你 > 运行中 > 等别的 Bot > 失败 > 闲置」排。
- 每行：色点 + 名字 + 角色 / 状态文案（运行中显示「阶段 · 已跑时长」）/ 状态灯。
- 颜色不是唯一信号：六种态各有灯形（方块、实心圆、圆环、菱形、空心圆、半透明点），色盲也能分。

## 它不是什么

这三条是硬边界，写进代码也写在这里：

1. **会话级的页。** better-sidebar 的 tab 按 sessionId 记，切到某个 Bot 的会话之后，那个会话里没有这个页——它是你「总部」视角，不是每个会话都带的常驻面板。想回来就切回你原来的会话。
2. **只读。** 不能建 Bot、不能改模型、不能代发消息、不能停 Bot。看一眼，点进去，活在那个会话里干。真要操作请去 DS Bot 自己的界面。
3. **不共享选中态。** 每个 DSH 会话可以各自开各自的团队页，互不影响；这是有意的——两个窗口看不同 Bot 是正常用法。

其它说明：private Bot 只显示名字与状态，不显示内容预览；群聊（rooms）不在 v1 范围内，只用作「等谁」的线索；不注册 DS Bot 的原生侧栏项，因此不会和它抢位置。

## 安装

插件就在本仓库 `plugins/dsh-bot-team-tab/`。装进 desktop profile 分三步：

```jsonc
// 1. C:/Users/Administrator/.dsh/profiles/desktop/package.json —— dependencies 里加一行（路径按实际改）
"dsh-bot-team-tab": "file:C:/Users/Administrator/.dsh/bot/workspace/plugins/dsh-bot-team-tab",
```

```jsonc
// 2. 同一个文件 —— dsh.profile.bundles 数组里加一行（放在 "dsh-better-sidebar" 之后即可）
"dsh-bot-team-tab",
```

```bash
# 3. 在该 profile 目录下装依赖，然后重启 dsh web
cd C:/Users/Administrator/.dsh/profiles/desktop && pnpm install
```

也可以用 CLI 代劳第 1、3 步（它会转发给 profile 目录里的 pnpm）：`dsh plugin --profile desktop add C:/Users/Administrator/.dsh/bot/workspace/plugins/dsh-bot-team-tab`。但它不一定替你写 `dsh.profile.bundles`——装完去 package.json 里确认那一行在，不在就手补（第 2 步）。

重启后打开侧栏的「+」菜单，应该看到「团队 / Team」。没看到就查两件事：`dsh-better-sidebar` 是否为 0.30 以上（本页依赖它的 `registerTab`），以及浏览器控制台有没有 `dsh-bot-team-tab` 的加载报错。

## 六盏灯怎么读

| 灯 | 态 | 什么时候亮 | 数据来源 |
| --- | --- | --- | --- |
| 黄方块 | 等你 | 有审批待你批、或 Bot 的开场白等你选模型 | `work.approvals[].sessionId`、`bots[].waiting` |
| 绿实心圆 | 运行中 | 正在跑一个 turn | `work.bots[id]` |
| 蓝圆环 | 等别的 Bot | 群里的移交还没交回来 | `work.waiting[id].waits` |
| 红菱形 | 失败 | 卡在缺凭据 / 要登录之类的阻塞上 | `bots[].blocked` |
| 青空心圆 | 刚收工 | 干净跑完，7 秒内 | `justFinished` |
| 灰小点 | 闲置 | 以上都不是 | 兜底 |

判定是短路顺序，上面的先赢。失败超过 3 分钟没动静会降到「闲置」，但红色 `!` 留着——它还是坏的，只是不再占用你的注意力。

## 刷新节奏

页面可见时每 3 秒问一次 `POST api/bot`（`{endpoint:'state'}`）。页面隐藏或切走就停；失败按 3→6→12→24→30 秒退避，恢复后回到 3 秒。

3 秒是下限，不是随便定的：`state` 端点每次都要 refresh + bootstrap + catalog + loadSecrets，它不是纯读接口，问得越勤宿主越慢。

## 自测

不需要浏览器、不需要 DSH、不联网——把 `lib/client.js` 当浏览器那样加载，喂固定数据跑判定与分组的断言：

```bash
node scripts/selftest.mjs
```

当前 17 项全通过。它覆盖六态判定与优先级、分组排序与未知分组归属、颜色派生、时长文案、以及轮询下限这些不需要眼睛看的部分；灯长什么样得你打开看。

## 关掉 / 卸载

临时关掉：在 profile 的 `cordis.patch.yml` 里按 id 覆盖，不用删包。

```yaml
- id: bot-team-tab
  name: 'dsh-bot-team-tab'
  disabled: true
```

彻底卸：从 `dsh.profile.bundles` 和 `dependencies` 里删掉那两行，`pnpm install`，重启。

## 兼容性

对着 ds-bot 0.3.6 的 `api/bot` 写的。字段读法一律「有就用、没有就降级」：`bots[]`、`sections[]`、`work.bots`、`work.waiting`、`work.approvals`、`bots[].blocked` 缺任何一个都不崩，最差就是全部显示闲置。DS Bot 升级后如果某个字段换了名字，这一页会退化成一张「都闲着」的名单，而不是报错白屏——这是有意的。
