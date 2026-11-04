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
├── digest/               每日关注摘要（一个日期一份，agent 写、插件只读）
├── media/                唤醒时取回的媒体（7 天 / 单会话 200MB 清理）
├── states/*.pos          监听水位（skill 形态）
└── logs/                 轮询与后端日志
```

消息正文**只在待回时**落本机：`recent[].content` 不上传、不进日志；处理完/知会/已发只留指针，
历史正文回平台在线查。学风格只取本人发言并脱敏（`scripts/data_guard.py`）。

## 一个文件，三层

| 层 | 一行是什么 | 关键字段 |
| --- | --- | --- |
| `config` | 插件配置，改动即时生效 | `poll.*`、`platforms`、`dsh.timeout`、`dsh.full_access`、`dsh.idle_reset_min`、`dsh.warm_min` |
| `chats` | 一个会话（一个人或一个群） | `watching`、`timer`、`blocked`、`last_msg_id`、`last_epoch`、`dsh_session`、`prompt_session`、`last_warm_at`、`last_reset` |
| `chats[].recent` | 最近 10 条消息**指针** | `kind`(dm/mention/fyi/out)、`state`(new/opened/replied/ignored)、`msg_id`、`msg_type`、`app_link`、`media_id`、`media_paths` |

`recent` 不是聊天记录库：最多 10 条、最新在前，`content` 只在 `new`/`opened` 的私聊与 @我 上保留；
`fyi`/`out` 与处理完的行正文为空；超过 10 条裁最旧，更早正文回平台查。指针不按时间删——
去重与待回状态靠 `msg_id`，否则同一消息再次进入拉取窗口会重新变待回。

## 画像文件

每个服务对象一份 `profiles/<platform>/<chat_id>.md`：对方是谁、沟通偏好、
在意与忌讳、历史结论。DSH 壳内 agent 用首轮唤醒载荷给的路径自己读、自己改；插件不注入
画像正文、不解析回复、不代写。面板也读写同一份。`dsh.full_access=true` 时插件把会话
切到 `danger-full-access`，否则 `workspace-write` 会拒绝写工作区外的画像目录。
`env.json` 只读，画像正文不写回它。

## 每日关注摘要

`digest/YYYY-MM-DD.md` 由 agent 按 `SKILL.md §值守日报` 维护：整份覆盖写、一个会话一行、
问题消失行就消失、跨天把未结项带过来。插件只做一件事：`GET /api/digest` 把文件原样读给面板，
不建目录、不写、不解析、不统计——判断归 agent（`AGENTS.md §设计铁律` 第 8 条）。格式见
`SKILL.md`，取舍见 `docs/specs/archive/0019-daily-digest.md`。

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

插件壳支持 `feishu` / `wecom` / `dingtalk`，`config.platforms` 是启用开关（默认前两个）。
没启用的平台不跑 `whoami`、不轮询；存量 `dingtalk` 会话保留在 state，启用后照常拉取。

## 拉取节奏：快慢两条车道，三条按需路径

| 路径 | 触发 | 冷却 | 额外约束 |
| --- | --- | --- | --- |
| 快车道 | 每 `fast_sec`（默认 60 秒，`0` 关） | `cooldown_sec` | 只拉 `candidates()` 选中的；不刷会话列表、不写 `runtime` |
| 慢车道 | 每 `interval_min`（≥10 分钟） | — | `whoami` + 刷会话列表（发现新会话）+ 再拉一轮候选 |
| 点开会话 | 面板进详情 | 20 秒 | **只读**：补拉/分类，不唤醒、不推进水位 |
| 手动 | 「立即拉一轮」/ 单会话「拉一次」 | 20 秒 | 整轮/单会话都进 `last_result`，不绕过冷却 |
| post-turn | turn 成功后 | 无 | 唯一 `force` 例外，用来闭合 agent 刚发出的消息 |

快慢两条车道共用 `cycleLock`，不并发；快车道撞上慢车道时让过。

`candidates()` 的选中规则（**这就是成本模型**）：

```
平台在 platforms 里 且 blocked=0 且 watching=1，然后：
  私聊：timer=-1 → 跳过；否则拉
  群聊：只有 timer=1 才拉（默认 -1，一个都不拉）
```

群默认不拉是有意的：一个 500 人群进了快车道就是每分钟一次拉取，等于用你的账号在群里做
全量监听，既贵又不合适。真要做群客服，在那个群上勾「定时检测 @我」，它才进轮询
（勾了也会按 `fast_sec` 拉，一天约 1440 次，体检页有估算）。

## 消息分类与去重

| kind | 判据 | 进收件箱 |
| --- | --- | --- |
| `dm` | 单聊里别人发的 | ✅ |
| `mention` | 群里 @我（匹配 `self_names`） | ✅ |
| `fyi` | 群里没 @我，但会话在盯 | 只在「全部」里出现 |
| `out` | 我自己发的（防回环） | ❌ |

分类在 `poller.process()` 里**只判一次**，判完写进 `recent`，前端不再重算。
去重靠 `msg_id` + `last_msg_id`：消息按最新在前遇到水位 ID 停止，同秒多条不再漏；
水位掉出拉取窗口时回退 `last_epoch`。同一批里出现本人消息时，更早的待回直接标 `replied`。

**待回闭环**：拉取时看到本人（或 agent 代发）的新消息，会把该会话里
**严格早于**它的待回标成 `replied`——收件箱不会留下永远消不掉的「待回」。
严格小于是有意的：同一秒到达的新消息宁可留在待回里，也不静默吞掉。

## 媒体取回与清理

只在**命中唤醒**时取本批待回消息的媒体，定时轮/点开/fyi/out 都不下载。
`im.js` 的 `MEDIA_ADAPTERS` 决定适配类型：飞书 image/file/audio/media/post，
企微 image/file/voice/video；sticker 只标 `[表情]`，其余类型在 prompt 标“未适配”。

- 图片下载后经 `attachments.admitPromptContent()` 变成 DSH image block，随 user message
  交付；模型不支持图片输入、附件服务缺失或超限时降级为文本 + 本地路径。
- 文件/语音/视频落 `~/.im-standin/media/<platform>/<chat>/<msg>/` 并在 prompt 给路径；
  `state.json` 只存 `media_paths`，不存二进制。
- 单批上限 4 张图 / 合计 10MB（优先读 DSH `attachments.imageLimits`）、单条 20 秒；
  失败只降级，不阻断 turn。
- 启动时与每日清理 7 天前文件、单会话超过 200MB 从最旧删；清理后回写 `media_paths`。

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
