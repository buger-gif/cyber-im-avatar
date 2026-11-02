# 02 数据与会话状态 — 谁被拉、拉到什么、存哪

> 目标态描述。改 `state.json` 字段必须同步 `docs/specs/contracts/02-storage.md`，
> 否则 `tests/test_docs.py` 会红。

## 落盘位置

```
~/.im-standin/            目录 0700
├── state.json            唯一状态：配置 / 值守名单 / 最近 10 条指针（0600）
├── state.json.bak        上一次写入的备份
├── env.json              各平台 CLI 路径、本人身份（只读，skill 形态共用）
├── panel.db.migrated     旧 SQLite，只作迁移证据，运行期不再读
├── persona.md            本人语气（学风格产出，只含风格不含事实）
├── profiles/             服务对象画像（一个对象一份 Markdown）
├── states/*.pos          监听水位（skill 形态）
└── logs/                 轮询与后端日志
```

消息正文**只在待回时**落本机：`recent[].content` 不上传、不进日志；处理完、
知会、已发的行只留指针，需要历史正文时回平台在线查。学风格时只取本人发言并
脱敏（`scripts/data_guard.py`）。

## 一个文件，三层

| 层 | 一行是什么 | 关键字段 |
| --- | --- | --- |
| `config` | 插件配置，改动即时生效 | `poll.*`、`platforms`、`dsh.timeout` |
| `chats` | 一个会话（一个人或一个群） | `watching`、`timer`、`blocked`、`last_epoch`、`dsh_session` |
| `chats[].recent` | 最近 10 条消息**指针** | `kind`(dm/mention/fyi/out)、`state`(new/opened/replied/ignored)、`msg_id` |

`recent` 不是聊天记录库：最多 10 条、最新在前，`content` 只在
`new` / `opened` 的私聊与 @我 上保留；`fyi` / `out` 以及处理完的行正文为空。
超过 10 条时裁掉最旧的；更早的正文回平台在线查。指针行不按时间删——
去重与待回状态还要靠 `msg_id`，否则同一消息再次进入拉取窗口会重新变待回。

## 画像文件

每个服务对象一份 `profiles/<platform>/<chat_id>.md`：对方是谁、沟通偏好、
在意与忌讳、历史结论。skill 起草前只读当前对象的这一份，每轮把长期有效的
新事实增量合并回去；面板也读写同一份。`env.json` 只读，画像正文不写回它。

## 会话状态

```
                         ┌── watching=1 ────────────────▶ 定时轮候选（私聊）
发现（refresh_chatlist）─┤
                         ├── watching=1, group, timer=1 ─▶ 定时轮候选（群）
                         └── blocked=1 ─────────────────▶ 不拉、不进收件箱、不计未读
```

四个独立开关，别当成一个状态机去理解：

| 字段 | 取值 | 语义 | 谁改 |
| --- | --- | --- | --- |
| `target` | 0/1 | 服务对象（有画像） | 加入值守自动置 1 |
| `watching` | 0/1 | 用户显式加入值守 | 面板 / `/api/watch` |
| `timer` | -1 / 0 / 1 | -1 明确不拉；0 跟随默认；1 强制定时拉 | 面板 / `/api/chat/timer` |
| `blocked` | 0/1 | 屏蔽 = 不同步 | 面板 / `/api/chat/block` |

`blocked` 优先级最高：`candidates()` 先过滤，`pollChat()` 再兜一次，
所以「定时 / 点开补拉 / 手动单会话」三条路都进不来。屏蔽不删消息——
只是把该会话 `new/opened` 的待回标成 `ignored`，取消屏蔽后指针仍在。

## 拉取节奏：三条路径，一个收口

| 路径 | 触发 | 冷却 | 额外约束 |
| --- | --- | --- | --- |
| 定时轮 | 每 `interval_min`（≥10 分钟） | 轮询间隔 | 只拉 `candidates()` 选中的 |
| 点开会话 | 面板进详情 | 20 秒 | 在线拉 30 条，合并后本地仍只留 10 |
| 手动 | 「立即拉一轮」/ 单会话「拉一次」 | 20 秒 | 整轮/单会话都同步到 `last_result` |

`candidates()` 的选中规则（**这就是成本模型**）：

```
平台在 platforms 里 且 blocked=0 且 watching=1，然后：
  私聊：timer=-1 → 跳过；否则拉
  群聊：只有 timer=1 才拉（默认 -1，一个都不拉）
```

群默认不拉是有意的：一个 500 人群每 10 分钟拉一次，等于用你的账号在群里做全量监听，
既贵又不合适。真要做群客服，在那个群上勾「定时检测 @我」，它才进轮询。

## 消息分类与去重

| kind | 判据 | 进收件箱 |
| --- | --- | --- |
| `dm` | 单聊里别人发的 | ✅ |
| `mention` | 群里 @我（匹配 `self_names`） | ✅ |
| `fyi` | 群里没 @我，但会话在盯 | 只在「全部」里出现 |
| `out` | 我自己发的（防回环） | ❌ |

分类在 `poller.process()` 里**只判一次**，判完写进 `recent`，前端不再重算。
去重靠 `msg_id` + `last_epoch`：只有时间戳严格大于水位、且状态为 `new` 的
`dm/mention` 才进唤醒批次；同一批里出现本人消息时，更早的待回直接标 `replied`。

**待回闭环**：拉取时看到本人（或 agent 代发）的新消息，会把该会话里
**严格早于**它的待回标成 `replied`——收件箱不会留下永远消不掉的「待回」。
严格小于是有意的：同一秒到达的新消息宁可留在待回里，也不静默吞掉。

## 收件箱聚合

`/api/inbox` 从 `recent` 现算，不落第二份索引：按 `(platform, chat_id)` 聚合，
`count` = 该会话命中的条数，`unread` = 其中 `new`，排序键是会话最后一条消息时间。
每组带 3 条预览；`?group=msg` 退回逐条模式（排障用）。屏蔽会话在派生时直接排除。

## 迁移策略

一次性脚本 `node scripts/migrate-state.mjs`：读旧 `panel.db` 的 chats +
每会话最新 10 条消息 + `panel.json` 配置 + `env.json` 目标索引，写 `state.json`；
旧库改名 `panel.db.migrated`，运行期不再读 SQLite。

原则：**迁移只能放宽，不能改变行为**。存量群 `timer=0`（旧语义=不拉）统一成 -1；
私聊保留原 timer；`blocked`/`watching`/工作区/DSH 会话原样搬；正文按新规则清理。
一次升级让用户突然多出几十个群的轮询，是不可接受的。
字段以 `docs/specs/contracts/02-storage.md` 为准，测试会拿真实 `State` 对账。
