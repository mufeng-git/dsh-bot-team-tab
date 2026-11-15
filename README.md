# dsh-bot-team-tab

左侧栏里**一个 Bot 一行，行名就是 Bot 的名字**（「玄机」「小助手」…）：点一下就进那个 Bot 的会话，没有中间页、没有设置行。普通会话列表里，Bot 的会话尾巴上多一个小 **BOT** 胶囊。

配合 [ds-bot](https://www.npmjs.com/package/ds-bot) 使用。纯客户端插件：没有宿主工具、没有 HTTP 路由、不写 DS Bot 的任何数据、不依赖第三方侧栏插件。

> 名字里的 tab 是初版留下的（那时它挂在 better-sidebar 的右栏）。现在长在左侧栏，目录名保留只为不打断已装的那条依赖。

## 它长在哪

DSH 左侧栏的官方插槽只有 `sidebar.panellist`：一行图标 + 一行文字，点击 = 选中同名 key 的 `main` 面板。本插件就注册这两处：

- `sidebar.panellist`，每个 Bot 一行，`order: -1`（紧贴「新建会话」），`label()` 返回该 Bot 的当前名字，改名会跟着变。
- `main`（keyed）：行 id 与面板 key 相同，点行即有页面可选中。

Bot 行点开的面板 `JumpPanel` 挂载瞬间做一件事：`uiWorkspace.openSession(bot.sessionId)` → `layout.selectPanel(null)` 退回原界面。所以观感是「点一下直接进那个 Bot 的会话」，没有中间页停留。Bot 还没有会话时显示一行提示，不会静默失败。

## 数据从哪来

每 5 秒 POST 一次同源 `api/bot`（body `{endpoint:'state'}`），只取 `bots[]` 的 `id / name / sessionId / state`。请求失败按 5s → 10s → 20s → 30s 退避，恢复后回 5s。名字优先 `name`，缺失用 id 兜底。

## 自测

```
node scripts/selftest.mjs     # 11 checks: normalize + unwrap + 注册了哪些行
node --check lib/client.js
```

改了 lib/client.js 之后**必须彻底退出 DSH 再启动**，客户端 bundle 只在 App 启动时装载，刷新页面不生效。

## 点击没反应时看日志

插件把每一步写进宿主日志，点一下行就有据可查，不用靠猜：

```
~/.dsh/logs/dsh-bot-team-tab.log      # 覆盖路径：环境变量 DSH_BOT_TEAM_LOG
```

浏览器侧 POST 同源 `api/bot-team/log`（body `{t, v, event, data}`），宿主半边（`lib/index.js`）用 `ctx.connection.fetch.register` 挂这一条路由，把每个事件追加成一行 JSON。一次点击按顺序应该看到：

| event | 含义 |
| --- | --- |
| `apply:start` / `apply:slots` | bundle 装载，以及宿主给没给 slots / uiWorkspace / layout |
| `panel:watch:ready` | 已订阅 `layout.panelInfo`，点行时靠它触发跳转 |
| `poll:ok` | 拿到 bot 名单（只在名单变化时写一行） |
| `row:register` / `main:register` | 行与它对应的面板页各注册一次 |
| `panel:change` | 侧栏真的选中了某个面板 id（`zdhcs:bot:<botId>`） |
| `jump:start` / `jump:opened` | 开始跳转，以及 `uiWorkspace.openSession` 是否返回 |
| `jump:openSession:error` | 宿主拒绝打开这个会话时的错误原文 |

缺哪一行，就说明断在哪一步：没有 `panel:change` 是行没选中面板（`main` 没注册上），有 `panel:change` 没有 `jump:start` 是订阅没装成，有 `jump:openSession:error` 则是宿主不认这个会话 id。

## 安装

**从 GitHub 装（换机器、重装 DSH 后恢复）**：仓库 `mufeng-git/dsh-bot-team-tab` 已公开，按 tag 发版。先把包名加进 profile 的 `dsh.profile.bundles`（`dsh-bot-team-tab`），再

```
dsh plugin --profile desktop add github:mufeng-git/dsh-bot-team-tab#v0.3.3
```

装完**彻底退出 DSH 再启动**。私有库用 `github:` 短写会 404（走 codeload 匿名下载），需要 `git+ssh://git@github.com/mufeng-git/dsh-bot-team-tab.git#v0.3.1` 或转公开。

**本机开发用 `file:`**：`profiles/desktop/package.json` 里写 `"dsh-bot-team-tab": "file:C:/Users/Administrator/.dsh/bot/workspace/plugins/dsh-bot-team-tab"`，改完源码跑 `scripts/install-to-profile.cmd` 同步到 `profiles/desktop/node_modules/dsh-bot-team-tab/`，再重启。这条路上改一行就能测，不用每次 push。

> 两种写法互斥：`github:` 装的是 tag 快照，本地改了不会生效；反复改插件时用 `file:`。
