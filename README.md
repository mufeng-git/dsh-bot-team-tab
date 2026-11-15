# dsh-bot-team-tab

DS Bot 队友的左侧栏入口插件。它为每个 Bot 在 DSH 左侧栏注册一行，行名即该 Bot 的名称；点击该行即打开该 Bot 的会话，不经过中间页面，也不提供额外的设置入口。

## 功能范围

| 能力 | 说明 |
| --- | --- |
| 一行一个 Bot | 左侧栏按 Bot 逐一列出，「新建会话」之下同组排列；Bot 改名后行名随之更新。 |
| 点击即进入会话 | 点击任意一行，主区域直接切换到该 Bot 的 DSH 会话；面板不驻留、不显示落地页。 |
| 会话列表标记 | 属于 Bot 的会话在其行尾显示 `BOT` 胶囊，便于与普通会话区分。 |
| 自动同步 | 每 5 秒从 DS Bot 读取一次 Bot 清单，新增的 Bot 自动出现，移除的自动消失；连接失败按 5/10/20/30 秒退避重试。 |

## 环境要求

- DSH 桌面版或 Web 版（`dsh.client.platform = web` 的客户端插件形态）。
- 已安装 DS Bot 插件，其宿主路由 `/api/bot` 可用；插件通过该路由的 `state` 端点读取 Bot 清单。
- 无需修改 DSH 本体，也不依赖其它侧栏类插件。

## 安装

从 GitHub 安装（推荐，版本号与 tag 一致）：

```bash
dsh plugin --profile <profile 名> add github:mufeng-git/dsh-bot-team-tab#v0.3.4
```

本地开发时改为文件源，二者互斥：

```bash
dsh plugin --profile <profile 名> add file:/绝对路径/plugins/dsh-bot-team-tab
```

客户端 bundle 仅在 DSH 启动时装载，安装或更新后须彻底退出 DSH 再启动，刷新页面不会生效。

## 使用

1. 启动 DSH，确认左侧栏出现以 Bot 名称命名的行（例如「玄机」「安澜」）。
2. 点击任意一行，主区域即显示该 Bot 的会话。
3. 若该 Bot 尚无会话，行仍会显示，点击后提示「这个 Bot 还没有会话」。

## 实现说明

- **注册位置**：`sidebar.panellist`（左侧栏列表行）、`main`（行被选中时主区域的面板，键与行 id 一致，先行后页注册）、`sidebar.session.row.trailing`（会话行尾标记）。
- **点击链路**：行的选中由宿主完成，插件订阅 `layout.panelInfo`；`activePanelId` 变为本插件的面板 id 时，取消面板选中并调用 `uiWorkspace.openSession(sessionId)`。跳转挂在状态订阅上而非组件挂载上，避免出现「页面渲染了但跳转没执行」的时序缺口。
- **服务获取**：`uiWorkspace` 与 `layout` 不写进模块级 `inject` 声明，而由 `ctx.inject([...], scope => ...)` 取得；该 scope 晚于 `apply` 到达或被替换时会重新绑定，面板订阅随之重挂。
- **数据来源**：`POST api/bot`，请求体 `{"endpoint":"state","payload":{}}`，响应为 `{ok:true,value}` 信封；`bots[]` 的 `id`、`name`、`sessionId` 为唯一依赖字段。

## 日志与排障

客户端与宿主写入同一条日志：`~/.dsh/logs/dsh-bot-team-tab.log`（可用环境变量 `DSH_BOT_TEAM_LOG` 指向其它路径），每行一条 JSON，包含 `v`（插件版本）与 `event` 字段。

| 事件 | 含义 |
| --- | --- |
| `apply:start` / `apply:done` / `apply:error` | 插件装载与失败原因。 |
| `services:ready` / `services:gone` / `services:inject:error` | 服务作用域的取得、替换与失败；`probe` 字段记录 `ctx.get` 与直接属性两种取法的结果。 |
| `panel:watch:ready` / `panel:watch:unavailable` | 面板选中订阅是否装上；后者表示 `layout.panelInfo` 不可用。 |
| `panel:change` | 宿主面板选中发生变化。 |
| `jump:start` / `jump:opened` / `jump:noWorkspace` / `jump:openSession:error` | 一次点击的完整链路与失败原因。 |
| `poll:ok` / `poll:error` | Bot 清单拉取结果。 |
| `row:register` / `row:drop` | 行的注册与移除。 |

点击无反应时，先确认日志中的 `v` 与已安装版本一致，再看 `jump:*` 与 `services:*` 两条链路。

## 开发与自测

```bash
node --check lib/client.js
node scripts/selftest.mjs
```

自测以桩件模拟宿主 `window.__ModuleLoader__` 与 `ctx.inject`，覆盖响应信封解析、行与页的注册、行名取值、会话行标记，以及「选中一行后取消面板并打开对应会话」的点击链路，共 13 项。

## 兼容性

- 插件面向 DSH 0.2 起的客户端插件接口（`dsh.manifestVersion = 1`）。
- 宿主若不提供 `main` 面板插槽，行仍可注册，但点击不会跳转；日志中会出现 `panel:watch:unavailable`。

## 版本

| 版本 | 变更 |
| --- | --- |
| 0.3.4 | 服务改为经 `ctx.inject` 取得并支持重新绑定，修复点击后提示「连不上 DS Bot」；补充服务探测日志；重写插件说明。 |
| 0.3.3 | 增加宿主日志端点与客户端埋点；跳转改挂面板选中订阅。 |
| 0.3.2 | 修正 `/api/bot` 的信封解析，行得以显示。 |
| 0.3.1 | 撤销设置行，一行一个 Bot，行名即 Bot 名称。 |
| 0.3.0 | 由单一面板改为一行一个 Bot。 |

## 许可

MIT。
