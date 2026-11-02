# 01 形态与传输 — 为什么这台机器上不多一个端口

> 目标态描述。改了 `lib/index.js` 的挂载方式或 `lib/app.js` 的传输层，
> 或者想「顺手起个本地服务」之前，先读这篇。

## 同一个仓库，两种形态

| 形态 | 入口 | 谁在等消息 | 适合 |
| --- | --- | --- | --- |
| Skill | `SKILL.md` + `scripts/*_listen_cli.py` | agent 自己起一个阻塞进程，命中才退出 | 挂在 Claude Code / WorkBuddy 里，按需值守 |
| DSH 插件 | `dsh-plugin/` | 宿主进程内定时轮询，收件箱展示；命中唤醒绑定 DSH 会话 | 想要一个常驻 GUI：侧边栏席位、右侧栏收件箱、分身实例 |

两者共用同一套平台适配知识（`references/`）和同一份 CLI 登录态（`~/.im-standin/env.json`），
但**代码不共享**：skill 侧是 `listen_core.py` + 三个适配器，插件侧是 `lib/im.js`。
这是有意的——skill 要能在没有 DSH 的机器上跑，插件要常驻且带 GUI，硬合并会让两边都变脆。

## Skill 形态：等待发生在脚本里

```
listen_cli --chat-id X --until T   （阻塞轮询本地 CLI，最多到 T）
   ├─ 命中  → exit 0 + stdout 一行 JSON（hit/chat_id/sender/content/pending_in_burst）
   ├─ 到点  → exit 3（重挂，沿用同一个 --until，不重置截止时间）
   └─ 出错  → exit 2
```

关键取舍是**把等待放进脚本而不是 cron**：cron 每 5 分钟唤醒一次 agent，一天 288 次空跑；
这里只有真实消息才会让 agent 醒。代价是必须有人（或 agent）负责重挂——所以退出码是契约的一部分。

## 插件形态：Node 单进程，宿主内路由

```
每 interval_min（≥10 分钟）
  ├─ 刷会话列表（只取元数据，不拉正文）
  ├─ 拉值守私聊 + timer=1 的群
  ├─ 分类进每会话最近 10 条，收件箱/计数从这 10 条派生
  └─ 面板轮询 /api/status 拿计数，不靠推送
点开会话 → 在线拉 30 条，失败回退本地指针
手动「拉一轮」 → 立即跑整轮（不受 10 分钟限制）
屏蔽的会话 → 定时 / 点开 / 手动三条路全不进
```

面板**没有 SSE / WebSocket**：状态是幂等的小 JSON，前端 60 秒轮一次比维护长连接便宜，
也避免了「连接断了看起来像挂了」这类假故障。面板停靠在 DSH 右侧栏
（`sidebar.right.pane.tab`），不是浮在页面中央的窗口。

## 零端口：同源路由，没有第二层服务

0.3.0 之前插件在 `127.0.0.1:8787` 起 HTTP 服务；0.4.0 改成宿主路由 + Python stdio 子进程。
0.8.0 最终形态把子进程也删了：整个后端就是 DSH 宿主进程里的几个 ESM 模块。

```
浏览器 ──同源──▶ DSH:3080/plugins/im-standin/api/*
                        │  lib/index.js 校验后直接调 App.handle()
                        ▼
             lib/state.js / poller.js / im.js / turns.js
                        │
                        ├─ spawn 平台 CLI（拉取 / 发送 / 搜索）
                        └─ sessionController + agent.followup（唤醒 DSH 会话）
```

收益：整机唯一的监听 socket 还是 DSH 那个；Cookie 天然同源，不需要为面板单独发凭据；
没有子进程协议、没有 Python 运行时、没有 SQLite，插件崩了不会留下半死的进程。

## 三层转发校验

`lib/index.js` 的 `handler()` 里，任何一条不过就直接 403/401，不进 API：

| 校验 | 挡什么 |
| --- | --- |
| socket 地址是回环 | 外部主机直连 |
| `Host` 是回环名（`127.0.0.1` / `localhost` / `[::1]`） | DNS rebinding（域名解析到 127.0.0.1） |
| 有 `Origin` 时必须与 `Host` 同源 | 跨站表单 / 第三方页面 fetch |
| 请求头 `x-im-token` 等于本进程随机 token | 同机其它页面猜路径 |

token 用 `randomBytes(24)` 在进程启动时生成，经 `webserver/index-inject` 注入成
`globalThis.IM_STANDIN_TOKEN`，**不落盘、不进日志**。所以刷新 DSH 之后旧页面会 401——
这是预期行为，刷新即可。

没有 `webServer` 能力的 profile 里，`mount()` 不挂路由，也不启动轮询。

## 后端模块分工

| 文件 | 职责 | 不该有的东西 |
| --- | --- | --- |
| `lib/index.js` | 同源路由、token、面板注入、装 skill、宿主服务接线 | 业务规则、平台分支 |
| `lib/app.js` | `/api/*` 路由表与参数校验 | 平台命令行细节、直接读写文件 |
| `lib/state.js` | `state.json` 归一化、收件箱派生、原子写 | 网络与轮询 |
| `lib/poller.js` | 轮询调度、拉取节奏、分类、唤醒判定 | 平台命令拼装 |
| `lib/im.js` | 平台适配（拉列表 / 拉消息 / 发消息 / 搜索 / 身份） | 调度策略 |
| `lib/turns.js` | live turn 状态机、prompt、画像回写、取消 | 平台命令行细节 |
| `lib/profiles.js` / `workspaces.js` / `sessions.js` | 画像文件、DSH 工作区只读适配、会话路径换算 | 轮询 |

依赖方向是单向的：`app → poller → {state, im, turns}`；`turns → profiles/workspaces`。
反向引用一律不许。
