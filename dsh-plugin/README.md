# dsh-cyber-im-avatar · IM 分身壳

把仓库根目录那套 skill（`SKILL.md` + `scripts/`）做成 DeepSeek Harness 里的常驻壳：
侧边栏一个席位，点开是收件箱、每日关注、分身实例、服务对象档案与手动发送。

**分工（spec 0004）：插件只当壳，skill 是唯一的脑子。**

| 层 | 干什么 |
| --- | --- |
| 壳（本插件） | 按节奏拉取（耳朵）、命中唤醒绑定 DSH 会话（嘴）、消息展示 / 通知 / 手动发送（脸） |
| skill | 闭环协议、平台差异、铁律、故障自愈 |
| agent 会话 | 被唤醒后全权处理：自己调 IM CLI 拉上下文、调研、起草、发送 |

```text
cyber-im-avatar/dsh-plugin/
├─ package.json            # dsh.bundle(patch) + dsh.client(platform/inject)
├─ cordis.patch.yml        # 把 bundle 插进 web 组合
├─ lib/index.js            # 宿主半：同源路由 + token + 装 skill + 注入 DSH 服务
├─ lib/app.js              # /api/* 路由表与参数校验
├─ lib/state.js            # state.json：配置 / 值守名单 / 最近 10 条指针
├─ lib/poller.js           # 轮询、分类、收件箱、命中后唤醒
├─ lib/turns.js            # live turn：resolveAgent / followup / 等 turn/end / 取消
├─ lib/im.js               # 平台适配：lark-cli / wecom-cli 封装 + @我 判定
├─ lib/profiles.js         # 服务对象画像（profiles/<platform>/<chat_id>.md）
├─ lib/workspaces.js       # 工作区列表（读 ~/.dsh/storages/workspace.json）
├─ lib/sessions.js         # DSH 会话目录路径换算（只读）
├─ lib/client.js           # 构建产物（内联了 web/panel.js）
└─ web/panel.js            # 面板 UI 的唯一真源（原生 DOM，无框架）
```

**这个插件不在本机开任何端口。** 面板数据走 DSH 自己的 Web 服务（同源），
后端就是宿主进程里的这些 ESM 模块；整台机器上唯一的监听 socket 是 DSH 那个。
没有 Python 服务、没有 stdio 管道、没有 SQLite、没有 `dsh headless` 子进程。

## 装

```bash
# 需要一个 DSH（web profile）。已发到 npm，直接装包名：
dsh plugin --profile web add dsh-cyber-im-avatar
dsh web        # 重启后侧边栏底部出现「IM 值守」

# 或者装本地目录（改代码时用这个）
dsh plugin --profile web add ~/cyber-im-avatar/dsh-plugin
```

想让它出现在 DSH 的「插件 → 发现」里可搜可点，把市场索引加进去：

```text
https://raw.githubusercontent.com/buger-gif/cyber-im-avatar/main/dsh-plugin/market/index.json
```

前置：`lark-cli` / `wecom-cli` 已安装并登录。**skill 不用单独装**：插件首次启动会把
`cyber-im-avatar` 装到 `~/.agents/skills/cyber-im-avatar/`（npm 包自带副本；本地
link 安装读仓库根目录）。已经手装过同一份的不会被覆盖，只打一行提示。

起 DSH 建议用仓库里的脚本，别直接 `node bin.js web &`：

```bash
./scripts/start-dsh.sh            # 已在跑就只打印地址（幂等）
./scripts/start-dsh.sh --restart  # 先停再起
```

它做两件事：让 DSH 进独立会话（关掉终端也不会被连带关闭），并清掉代理变量与
`NODE_OPTIONS` 注入项。token 落到 `~/.dsh/web-token`（600）。

## 命中 → 唤醒 → 同会话续跑

值守会话来了新消息（私聊消息 / 群 @我），插件在宿主里拿**绑定的 DSH 会话**跑一轮
live turn。每次唤醒的载荷都**只追加本次新消息**：

1. 新会话首轮首行 `/cyber-im-avatar` —— DSH 的 user invocation，直接把 skill 正文注入
   这一步（闭环、平台差异、铁律、故障自愈都在 skill 里，prompt 不再抄）；之后同一
   会话不再重复入口；
2. 命中载荷（平台、chat_id、新消息、画像文件路径）+ 一句「监听由插件负责，不要挂」。

插件不注入画像正文、不解析 agent 回复、不代写画像；agent 按载荷里的路径自己读、自己改。
换会话或重置会话会重新带 `/cyber-im-avatar` 入口。进程被杀后 `state.json` 的
`prompt_session` 与 `recent` 还在，下一轮继续追加 pending/新消息，不重建完整载荷。

**富媒体在唤醒时取回**：只对本批待回消息下载，不动历史。图片用 DSH
`attachments.admitPromptContent()` 变成 image block，模型直接可见；文件/语音/视频
落 `~/.im-standin/media/` 并在 prompt 给本地路径；sticker 只标 `[表情]`。卡片、合并
转发、位置、名片、系统消息等未适配类型，以及下载失败的消息，才在 prompt 标“可用 CLI 取”。
单批最多 4 张图 / 合计 10MB、单条 20 秒；模型不支持图片或附件服务缺失时降级为
文本 + 本地路径，不阻断 turn。

agent 在这一轮里自己用 `lark-cli` 拉上下文、去绑定工作区核实事实（只读）、
起草并发送或等你在会话里确认——**它有多少工具就用多少，插件不封顶**。

> **壳内不挂监听**：轮询、水位、唤醒都是插件的事。agent 不运行
> `listen_cli` / `bootstrap.py`，也不重挂监听——壳内沙箱是 `workspace-write`，
> `~/.im-standin` 在工作区外，写不了；也不需要写。

- **同一通 IM 会话 = 一个长期复用的 DSH 会话**（`chats.dsh_session`），跨命中、
  跨重启累积历史；在 DSH 侧边栏能看到、能点开接着聊。
- **在飞 turn 可打断**：同一会话又来了新消息 → `agent.cancel` 旧 turn →
  **同 session** 重起，任务里注明「上一轮被新消息打断，以最新上下文为准」。
- **批次合并**：同一轮 poll 拉到多条新消息只起一个 turn，不让 agent 被连发消息叫醒 N 次。
- **并发安全**：就是宿主里的同一个 agent，DSH UI 打开它不再抢 `session.lock`；
  另一个 DSH 宿主持有写锁时才报 `session_locked_other_host`。
- **失败重喊**：turn 失败/超时后，积压还在就下一轮再喊；不自动连环重试。
- **重开会话**：实例卡片或会话详情点「重开会话」→ 打断在飞 turn、解绑当前会话；
  下次命中开新会话。旧会话保留在侧边栏，只是不再续聊。**这是唯一的换会话入口。**

单轮上限默认 600 秒（`dsh.timeout`）；有打断机制后，超时只剩防呆。

## 模型与会话都走 DSH

不需要在这儿再配一遍模型。插件在宿主进程内拿 DSH 的 `sessionController` /
`sessions`，模型、网关、凭据全部由 DSH 自己解析：

| 要什么 | 从哪读 |
| --- | --- |
| 会话 / agent | `ctx.sessionController.resolveAgent()` 或 `create()` |
| 模型 / 网关 / 凭据 | DSH 自己的 profile 配置与凭据库，插件**不读、不存、不回传** |
| 工作区 | `ctx.workspaceRegistry` + `~/.dsh/storages/workspace.json`（只读展示） |

所以「DSH 里能正常对话」=「值守能干活」。插件没有第二份 key、没有 headless profile、
没有起草模型设置。

## 实例的生命周期

一通值守会话 = 一个分身实例 = 一个 DSH 会话。插件管四件事：

| 事 | 行为 |
| --- | --- |
| 建 | 首个命中时 `create({workspaceId|cwd})`，DSH 自动把它归属到工作区 |
| 续 | 永久复用；历史与工具调用都落在同一个 `session-…` 里 |
| 断 | 新消息到达时 `agent.cancel` 在飞 turn，同 session 重起 |
| 换 | 只有用户点「重开会话」才换；旧会话留在侧边栏 |

实例卡片显示绑定会话、累计轮数、最近一次 turn 是否成功。累计轮数超过 50 只提示
「可新建」，不自动清理——上下文越长每轮 token 越贵，怎么做由你决定。

会话所在 cwd 与绑定的工作区不一致时（换了工作区），DSH 会拒用旧会话，
插件会丢掉旧 id 在正确工作区重开，并在实例卡上提示「已自动新建」。
显式工作区目录存在但未登记进 DSH 时，仍先恢复旧会话，不会每轮白开新的。


## 拉取节奏：定时 / 按需 / 手动

| 路径 | 什么时候发生 | 拉什么 |
| --- | --- | --- |
| 值守（快车道） | 默认每 **60 秒**（`poll.fast_sec`，0 = 关） | 值守中的私聊，以及你逐个勾了「定时检测 @我」的群 |
| 发现（慢车道） | 默认每 **10 分钟**（可调，**下限 10 分钟**，上限 240） | `whoami` + 刷会话列表（发现新会话），再补拉一轮候选 |
| 按需 | 点开某个会话时 | 在线拉 30 条；**群聊平时完全不进快车道**，只有勾了才进 |
| 手动 | 顶部「同步」、会话里的「拉取」、「设置 → 立即拉一轮」 | 不受间隔约束；同一会话 20 秒冷却，连点不会重复打接口 |

面板通知每 **60 秒**刷新一次（角标 / 收件箱 / 处理中状态），和拉取节奏是两件事。

为什么要给群单独一套规则：群消息量远大于私聊，绝大多数与你无关。真做群值守时，
在那个群卡片上勾「定时检测 @我」，它才按上面的间隔轮询；不勾就只在点开时拉一次。

每轮只刷一次会话清单（拿群名、判断私聊还是群），不读消息正文；正文只在真正要拉
那个会话时才取。本地每个会话只留最新 **10 条**，更早的正文与历史去平台在线查。

配置在 `state.json` 的 `config` 字段（老 `panel.json` 只在一次性迁移时读）：

```json
"poll": {
  "interval_min": 10,      // 下限 10，写 1 也会被抬到 10
  "dm_scope": "recent",    // 保留口径；实际候选只看 watching 私聊
  "dm_recent": 20,
  "per_chat_limit": 10,
  "refresh_chatlist": true,
  "cooldown_sec": 20
},
"dsh": { "timeout": 600 }
```

从 0.8.x 升级先跑 `node scripts/migrate-state.mjs`：旧库每会话最新 10 条、会话配置、
`panel.json` 配置与 `env.json` 目标索引搬进 `state.json`，旧库改名为
`panel.db.migrated`。老配置键 `poll_interval` / `recent_chats` / `per_chat_limit` /
`backfill_hours` / `poll_watched_only` 会自动翻译，`port`、`llm.*`、`reply.*`、
`dsh.profile`、`ui.*` 直接丢弃。

## 屏蔽：让某个群 / 某个人闭嘴

屏蔽之后**彻底不同步**：

| 屏蔽之后 | 行为 |
| --- | --- |
| 定时轮 | 不进（哪怕这个群还勾着「定时检测 @我」） |
| 点开会话 | 不补拉，只显示屏蔽前的历史 |
| 手动单会话拉取 | 直接拒拉，一次 CLI 调用都不发 |
| 收件箱 / 未读角标 | 里里外外都没有它，`/api/inbox` 与计数都不含它 |
| 已经压着的待回 | 屏蔽那一刻标成 `ignored` |
| 值守配置 | 保留；取消屏蔽后照常恢复（不补历史） |

入口：收件箱每行右侧的小铃铛、会话详情头部的「屏蔽」、分身页卡片上的「屏蔽」；
要放回来就去「分身 → 已屏蔽」。

## 用

点侧边栏「IM 值守」（带未读红点徽章），面板停靠在右侧栏，六个页签：

| 页签 | 内容 |
| --- | --- |
| 收件箱 | 待回 / 未读 / @我 / 私聊 / 全部；**按会话聚合**，点一行进详情 |
| 关注 | agent 写的每日摘要 `~/.im-standin/digest/YYYY-MM-DD.md` 原文；可切日期，超一天没更新会提示 |
| 分身 | 值守中的实例：工作区、DSH 会话、轮数、处理中状态、**去会话**、重开会话、屏蔽；下面是群聊列表、已屏蔽列表、搜人/搜群加入 |
| 服务对象 | 每个对象一份画像文件：直接读、直接改；agent 起草前只读这一份，不展示历史消息 |
| 体检 | 轮询节奏与范围、授权状态、DSH 运行时、skill 路径、最近错误 |
| 设置 | 值守节奏（值守秒数 + 发现分钟 + 私聊取前 N 个 + 立即拉一轮）、值守范围 |

**去会话**：实例卡与会话详情头部的「去会话」直接调 DSH 客户端的
`uiWorkspace.openSession(sessionId)`（侧边栏点会话用的同一条路），把主界面切到
绑定的那个 DSH 会话——看 agent 怎么调研、草稿写到哪、要不要确认，都在那边。
停靠态会顺手在目标会话的右侧栏补开值守面板，左会话右收件箱一起看；
老版本 DSH 没有这个服务时，退回复制会话 id，不假装跳成功。

会话详情里：画像摘要 → 消息气泡 → **手动输入发送** / 忽略。头部可换工作区、
开关值守、重开会话、拉取、屏蔽；有待回且 agent 空闲时多一个 **现在处理**，
不用等下一条新消息就能让它处理积压（只取最新 10 条）。agent 回复会由下一轮
拉取以「我」的消息出现，不需要面板再起草。

## 确认，还是全自动

没有插件开关了——**节奏由你和 agent 在值守会话里约定**：

- 默认：agent 起草后把回复留在会话里，你说「发」它才发（下一轮 `is_self`
  消息被拉回来，收件箱的待回自动收敛）。
- 全自动：你在那条会话里明确说「以后这个人的消息直接回」，agent 记住并照办。
- 涉及钱、合同、对外承诺：skill 铁律要求停下等你，任何模式都不替你承诺。

面板里的手动发送永远可用，且不经过模型——手打的就是你本人。

## 在 DSH 里长什么样

不是独立窗口，也不是浮层：侧边栏底部一颗入口席位（`sidebar.footer.action`，带未读
角标），点开后面板停靠在 **DSH 右侧栏**（`sidebar.right.pane.tab`，和文件 / 终端
同一个位置），左边继续看值守会话，右边处理消息。

点开后是和会话并排的右侧栏，不再遮住主界面。

- 右侧栏布局由 DSH 按会话保存：这个会话开过一次，下次回来还在；换到没开过的
  会话时点一下左下角席位即可。
- 详情里的「去会话」会切主界面到绑定会话，并把值守面板在目标会话的右侧栏补开，
  两边一起看。
- 需要带右侧栏扩展点的 DSH（按 0.2.1-rc.5 对齐）。没有右侧栏服务的版本不提供
  浮层回退：侧边栏席位仍在，点击会提示「这个 DSH 版本没有右侧栏服务」。

> 公开仓库不保存界面截图，避免真实或演示会话内容进入历史；界面可以用
> `node scripts/shot-dsh.mjs` 在本地起一个干净 DSH 复现。

## 外观

只有浅色和深色两套配色，**默认跟随 DSH 自己的主题设置**，面板里没有外观选项。
DSH 把主题解析结果写在 `body[data-ds-dark-theme]` 上（固定深色主题还会在
`html[data-ds-theme-source]` 留一份镜像），面板用 CSS 祖先选择器直接读这两个标记，
切换主题立即生效，不需要刷新，也不写 `state.json`。

## 值守会话绑定工作区

所有「加入值守」入口都会带工作区，默认取「上次在面板里选过的」→「现有会话最近在用的」
→ DSH 默认，不用每次重选：

- 下拉列表来自 DSH 自己的登记表（`~/.dsh/storages/workspace.json`），默认项标「默认」；
  「跟随 DSH 默认」表示不显式绑定。
- 会话详情里的工作区行**常显**：还没值守也能先选，打开值守时一起生效。
- 也能选「自定义路径…」，填绝对路径（不存在的路径会被拒，不替用户造目录）。
- 工作区就是 agent 跑 turn 的 cwd：它可以在里面读 README / 配置 / 文档核实事实，
  回复里不提「我看了什么文件」，也不复述路径。
- 改工作区会先把旧现场收拾干净：打断在飞 turn；已绑会话不在新工作区时立即解绑并提示，
  下一轮在新工作区开新会话；会话本来就在新工作区时保留。
- 显式绑定的目录被删/改名后，turn 会以 `workspace_missing` 失败并显示原因，不会悄悄
  换到默认工作区跑。空工作区才跟随 DSH 默认，面板会显示「默认 · <工作区名>」。

## 服务对象画像

`lib/profiles.js` 为每个对象维护一份 `~/.im-standin/profiles/<platform>/<chat_id>.md`，
面板与 agent 读写同一份；agent 起草前只读当前对象这一份，每轮把长期有效的新事实
增量合并回去。`env.json` 只读，目标索引不再写回它，也不保存画像正文。老版本 `profile`
笔记在 0.8.x 已迁入画像文件；0.8.0 的迁移脚本保留 `profiles/` 原样不动。

- 面板「服务对象」页可以浏览和编辑整份画像；不展示逐条历史消息。
- 壳内 agent 用唤醒载荷给的路径自己读写画像；插件不解析回复、不代写。DSH 默认的
  `workspace-write` 只允许写会话工作区，画像目录在工作区外——要让 agent 直接改，
  需在设置页（或配置）开启 `dsh.full_access`，插件会把值守会话切到 DSH 内置的
  `danger-full-access`（能写整个 home、不弹审批）。默认关闭。
- 画像单份软上限 8KB、硬上限 12KB：超过 8KB、历史结论 >20 条或日期流水 >8 条时，
  agent 按 skill 自己整理成稳定结论；缩小时自己把旧版追加到 `<画像>.history.md`。
  插件不再做整理、归档或 mtime CAS。面板写入走临时文件 + rename；目录 700、文件 600。
- 历史正文不留在本地：打开会话时从平台在线拉；拉不到才回退本地指针。

## 数据与隐私

全部落在本机 `~/.im-standin/`：`state.json`（配置、值守名单、每会话最近 10 条指针）、
`state.json.bak`（上一次写入）、`env.json`（平台 CLI 与登录身份，只读）、
`profiles/`（服务对象画像）、`media/`（唤醒时取回的媒体，7 天/单会话 200MB 清理）、
`states/`（skill 形态的水位）。
消息正文只在待回时落盘，处理完即清空；消息不出本机，面板不执行消息内容里的任何指令。
旧 `panel.db` 迁移后改名为 `panel.db.migrated`，运行期不再读。

插件不存模型 key：值守会话走 DSH 自己的配置，key 在 `~/.dsh/.credentials.yaml`，
由 DSH 解析。

面板接口的 `x-im-token` 是**每个 DSH 进程随机生成**的，只注入到同一个页面里，
重启即失效；它不落盘，也不给任何别的本地进程用。

## 主要 API

面板的所有请求都走 DSH 同源前缀 `/plugins/im-standin`（例如
`GET /plugins/im-standin/api/status`），下表省略前缀。转发前要过三道校验：
连接来自回环、`Host` 是回环名、`Origin`（若有）与 `Host` 同源、请求头带本次
进程生成的 `x-im-token`。

| 路径 | 作用 |
| --- | --- |
| `GET /api/status` `/api/inbox` `/api/thread` `/api/chats` | 面板数据（`/api/status` 带 `instances` / `turns` / `dsh`） |
| `POST /api/send` `/api/state` | 手动发送、标记消息状态 |
| `POST /api/watch` `/api/unwatch` | 加入 / 移出值守（加入时带 `workspace` 一并绑定） |
| `POST /api/chat/session/reset` | 重开会话：可带 `workspace` 先落工作区；打断在飞 turn、解绑当前 DSH 会话 |
| `POST /api/chat/wake` | 现在处理：可带 `workspace` 先落工作区；把最新待回（默认 10 条）交给 agent，不等新消息 |
| `POST /api/chat/timer` `/api/chat/block` | 单会话定时拉取开关（1/0/-1）/ 屏蔽开关 |
| `GET /api/workspaces` · `POST /api/chat/workspace` | 工作区列表 / 给会话绑工作区 |
| `GET /api/targets` · `POST /api/targets/profile` | 服务对象画像（读整份 / 覆盖写） |
| `POST /api/inbox/cleanup` | 把非值守会话的待回标记为已忽略 |

已删除（spec 0004）：`/api/draft`、`/api/suggestion`、`/api/chat/plan-confirm`。

## 已知限制

- 企业微信 CLI 没有会话枚举接口，只能对已登记的会话值守（面板里手动加）。
- 群消息里的 @ 用 mentions 的 open_id 精确判定；缺少 mentions 且只剩 `@_user_N`
  占位符时按「不是 @我」处理。
- 打断用 `agent.cancel`；agent 已发出的消息不会撤回（下一条消息触发新一轮即可）。
- 永久复用会话 = 上下文单调增长，token 成本随轮数上升；插件只提示，不自动新建。
- DSH 仍是 0.2 预览版，插件 API 可能随版本变化。本插件按 0.2.1-rc.5 对齐。

## 调试

```bash
# 迁移预演：只打印会写什么，不动 state.json / panel.db
node scripts/migrate-state.mjs --dry-run

# 看后端在回什么：打开 DSH 面板（同源 fetch），或跑 Node 测试
node --test

# 改完 web/panel.js 必跑：重建浏览器半
python3 scripts/build_client.py

# 截图（headless Chrome + CDP，对 DSH 页面拍）
node scripts/shot.mjs "http://127.0.0.1:3080/?token=$(cat ~/.dsh/web-token)" /tmp/shot.png 9000 1280 860

# README 那几张：起一个干净工作区的 DSH（它自己的 3099），注入示例数据后连拍
node scripts/shot-dsh.mjs screenshots
```

以上命令都在本目录（`dsh-plugin/`）执行。

DSH 起不来、turn 起不来这类问题，按 `docs/implementation/runbooks/troubleshoot.md` 排查。
