# DSH 客户端 API 核实记录

本文件只记**本机实测过**的结论，每条给出结论、证据与反例。新结论追加在对应小节下，不改写旧结论；结论被推翻时保留旧条目并注明作废版本。

实测环境：DSH 0.2.2-rc.3 desktop（Windows），插件 dsh-bot-team-tab 0.3.1 起；宿主源码取自 `D:/soft/dhs/resources/app.asar`（解包脚本见本仓库外 workpace `scripts/asar-*.mjs`）。

## 1. 服务必须经 ctx.inject 取得

- **结论**：模块级 `export const inject` 里声明的服务才可直接 `ctx.get()`；`uiWorkspace`、`layout` 不在声明内时，`ctx.get()` 返回 undefined，必须写 `ctx.inject(['uiWorkspace','layout'], scope => ...)`。
- **证据**：`dsh-client-ui-sidebar/src/client/index.ts:49` 的 `inject` 数组含 `uiWorkspace`、`layout`；`dsh-better-sidebar/lib/client.js:20746` 用 `ctx.inject([...], injected => ...)` 取同一批服务；`dsh-client-ui-workspace/src/client/navigation.ts:196` 以 `super(ctx, 'uiWorkspace')` 注册服务。
- **反例**：0.3.3 只声明 `inject: ['slots']` 并直接 `ctx.get`，日志为 `{"event":"panel:watch:unavailable","data":{"faces":{"openSession":false,"selectPanel":false,"panelInfo":false}}}` 与 `jump:noWorkspace`，点击落到「连不上 DS Bot」文案。0.3.4 改用 `ctx.inject` 后 `services:ready` 的 `probe` 三项为 true，点击即生效。

## 2. main 页必须先于同名 sidebar.panellist 行注册

- **结论**：为某 id 注册行之前，必须先注册 `key` 相同的 `main` 页；否则宿主选中该行时抛 `layout.selectPanel: main panel "<id>" is not registered`。注册顺序按 Bot 逐个成对（页在前），不能「先注册所有行、再补页」。
- **证据**：`dsh-client-ui-layout/src/client/service.ts:18-99` 的 `selectPanel` 对未注册 id 抛错；参考实现 `dsh-mcp-connector/lib/client.js:2503-2574` 的注释明确要求 main 先行。
- **反例**：无（该错误在开发早期即被参考实现的注释拦住）。

## 3. 行图标是工厂插槽，不是属性

- **结论**：`sidebar.panellist` 注册时的第二参是 React 组件，宿主通过 `sidebar.panel.icon` 工厂渲染，传入 `{ size, active }`；宽栏 16px、窄栏 18px。想换图标只能换这个组件，不能给它传 props。
- **证据**：`dsh-client-ui-sidebar/src/client/SidebarRoot.tsx:94-96` 的 `renderFactorySlot('sidebar.panel.icon', { id, size: wide ? 16 : 18, active })`；`PanelIcon.tsx:13-14` 转调 `renderSlot('sidebar.panellist', { size, active }, { only: id })`。

## 4. label 必须是函数

- **结论**：行名传字符串会在注册时固化，之后不随状态或语言变化；传函数则每次渲染重新求值。
- **证据**：参考实现 `dsh-mcp-connector/lib/client.js:2509-2517` 的注释与写法（`label: () => t(...)`）。
- **本次用法**：行名直接返回 store 里的 Bot 名称，Bot 改名后 ≤5 秒跟着变，测试 `an updated Bot name is picked up without re-registering the row` 覆盖。

## 5. openSession 自己会取消面板选中

- **结论**：`uiWorkspace.openSession(id)` 内部调用 `selectPanel(null)`，跳转后不需要（也不应依赖）自己再收一次面板；但**先**取消选中仍是安全的兜底，因为面板页存在即意味着主区域被占据一个渲染周期。
- **证据**：`dsh-client-ui-workspace/src/client/navigation.ts:294-296` 的 `openSession → replaceMain(target, signal, 'reveal')`，`:553` 处 `openSession` 自身调用 `selectPanel(null)`。

## 6. DS Bot 的界面切换是 localStorage 开关

- **结论**：DS Bot 不是独立视图，而是按 `localStorage['ds-bot:surface']`（`bot` | `agent`）决定是否用 `shadow()` 遮蔽宿主插槽。它从不注册 `sidebar.panellist`，因此在 bot 模式下本插件的行**不应**依赖原生侧栏可见性。
- **证据**：`ds-bot/src/client/surface.js` 的 `groupsFor({mode})` 与 `GROUPS = ['shell','conversation']`；`ds-bot/client.js` 中 `shadow()` 目标清单含 `sidebar.workspaces`、`conversation.chat.node` 等，`sidebar.panellist` 命中 0。
- **影响**：bot 模式下整列被 TeamSidebar 接管、DSH 原生全局行被收起；插件无法把入口补回该列。

## 7. 点击链路只能挂在状态订阅上

- **结论**：行的选中由宿主完成，插件拿不到行点击事件；可靠触发点是订阅 `layout.panelInfo`，在 `activePanelId` 变为本插件面板 id 时执行跳转。仅在面板组件 `useEffect` 里跳转会出现「页面渲染了但动作没跑」的时序缺口。
- **证据**：0.3.3 的日志序列 `panel:change → panel:mount → jump:start(via:"watch")`；0.3.4 保留 `attach()/stop()` 以便作用域替换后重挂订阅。
