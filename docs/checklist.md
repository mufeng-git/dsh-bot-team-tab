# 插件开工检查清单

适用于本仓库，也适用于任何要改动 DSH 客户端的插件。每条都来自一次真实的返工，反例里的版本号可以在 `CHANGELOG.md` 里对上。

## 1 先读契约，再写第一行代码

- 插槽名、组件收到的 props、注册顺序、模块 `inject` 数组，一律从宿主源码里读到原文：
  `node scripts/asar.mjs paths D:/soft/dhs/resources/app.asar <插槽名>`，再用 `cat` 看上下文。
- 先看 [DSH-API-核实记录.md](design/DSH-API-核实记录.md)，那里是已经核实过的结论，不要重复试错。
- 反例：0.3.1 没读 `/api/bot` 的信封就按裸 JSON 解析，`bots` 恒为空，白装一轮；0.3.4 没读模块 `inject` 数组，`ctx.get('uiWorkspace')` 恒为 `undefined`，再白装一轮。

## 2 先造眼睛，再交付

- 交付前必须有一条命令能看到运行时真相：本插件是 `POST /api/bot-team/log` 落到 `~/.dsh/logs/dsh-bot-team-tab.log`，每行带 `v` 与 `pid`。
- 反例：0.3.2 全凭截图里的错误文案猜代码分支；0.3.3 加上埋点后，十分钟定位。

## 3 自己装、自己验

- 装机自己跑：`npm run deploy`（`dsh plugin add` + 版本/`sha256`/`VERSION` 三点校验），不把「你去装一下」当交付。
- 客户端 bundle 只在 DSH 启动时装载：改完必须彻底退出再启动，刷新页面不够。

## 4 跨沙箱边界只做原子替换

- 写工作区之外的路径（`profiles/*/node_modules`）先写临时名再改名；禁用 `cp --remove-destination`，它会在写入被拒时先删掉目标。
- 命令按调用者的 shell 给：PowerShell 写 `$env:USERPROFILE`，cmd 写 `%USERPROFILE%`。
- 交给 cmd 的 `.cmd` 必须纯 ASCII：UTF-8 中文注释会被 GBK 读坏，吃掉后面的行。

## 5 版本三点一致

- `package.json` 的 `version`、`lib/client.js` 的 `VERSION`、git tag 三者必须相同；`npm test` 里有断言守着。
- 反例：0.4.0 只改了 `package.json`，日志仍报 0.3.4，只能补发 0.4.1。

## 6 先问目的，再问实现

- 形态类需求（总览面板 / 每项一行 / 两者并存）先给一张「用户看得见的效果表」再动手。
- 用户在两种形态之间来回改，是需求没收敛的信号：停下来把取舍讲清楚，而不是继续改代码。

## 7 动代码前先出规格书

- 写进 `docs/design/`，命名 `<日期>-<主题>-规格书-v1.md`，含范围、接口、验收标准、发布与回退；用户确认后再实现。

