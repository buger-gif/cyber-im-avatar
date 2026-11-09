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
├── profiles/people/<platform>/<person_id>.md  人物档案（跨会话，键＝消息发送者 ID；单聊只有这一份）
├── profiles/<platform>/<chat_id>.md           会话工作本（仅群：本群成立的规矩与上下文）
├── duty/                 私有值守台：policy.md（初始版本）+ decisions/<event_id>.json
├── digest/               每日关注摘要（一个日期一份，agent 写、插件只读）
├── media/                唤醒时取回的媒体（7 天 / 单会话 200MB 清理）
├── states/*.pos          监听水位（skill 形态）
└── logs/turns.jsonl      turn 事件流水（唤醒 / 打断 / 结束；无正文）
```

消息正文**只在待回时**落本机：`recent[].content` 不上传、不进日志；处理完/知会/已发只留指针，
历史正文回平台在线查。学风格只取本人发言并脱敏（`scripts/data_guard.py`）。

`logs/turns.jsonl` 只记事件名、平台 / 会话 ID、turn ID、耗时与原因，**不记正文、发送者与聊天名**；
512 KiB 轮转为 `turns.1.jsonl`，写失败只降级，不影响值守。它是排障流水，不是消息历史。

## 一个文件，几层记录

| 层 | 一行是什么 | 关键字段 |
| --- | --- | --- |
| `config` | 插件配置，改动即时生效 | `poll.*`、`platforms`、`dsh.timeout`、`dsh.full_access`、`dsh.warm_min` |
| `chats` | 一个会话（一个人或一个群） | `watching`、`timer`、`wake_mode`、`blocked`、`last_msg_id`、`last_epoch`、`dsh_session`、`prompt_session`、`last_warm_at`、`last_reset` |
| `desk` | 全局值守台（一个会话） | `workspace`、`dsh_session`、`baseline_at`、`last_sweep_at`、`session_turns` |
| `chats[].duty` | 一个会话的分诊记录 | `state`、`trigger`、`event_id`、`member_count`、`sweep_epoch`、`review_at` |
| `chats[].recent` | 最近 10 条消息**指针** | `kind`(dm/mention/fyi/out)、`state`(new/opened/replied/ignored)、`msg_id`、`msg_type`、`app_link`、`media_id`、`media_paths` |

`recent` 不是聊天记录库：最多 10 条、最新在前，`content` 只在 `new`/`opened` 的私聊与 @我 上保留；
`fyi`/`out` 与处理完的行正文为空；超过 10 条裁最旧，更早正文回平台查。指针不按时间删——
去重与待回状态靠 `msg_id`，否则同一消息再次进入拉取窗口会重新变待回。

## 画像文件

Markdown，都不在 `state.json` 里。**群两层，单聊一份**：

| 适用 | 路径 | 四段 | 放什么 |
| --- | --- | --- | --- |
| 人物档案（群 + 单聊） | `profiles/people/<platform>/<person_id>.md` | 身份与角色 / 沟通偏好 / 在意与忌讳 / 历史结论 | 跨会话稳定的人物评价、称呼与忌讳、与我的往来和承诺；**单聊的全部记忆** |
| 会话工作本（仅群） | `profiles/<platform>/<chat_id>.md` | 这个会话是什么 / 群内工作要求 / 成员与角色 / 本会话结论与待办 | 群目的、群规、回复口径、成员指针（名字 → 人物档案路径）、本群待办 |

- **归属判据**：单聊一律写对方的人物档案（只在这条私聊成立的备注用「私聊：」开头）；
  群按「换一个会话遇到这个人还成立吗」分——成立写档案，只在群里成立写工作本，
  两边都成立则档案写结论、工作本只留指针。
- **人物 ID**：消息里稳定的发送者 ID（飞书 `open_id` / 企微 `userid` / 钉钉 `senderId`），
  原样保留、不 lower、不用显示名；为空（系统消息）不建档案。单聊优先取最近一条非本人
  消息的发送者，无消息时按平台形态用 `chat_id` 兜底；钉钉推不出就退回会话工作本。
  文件名沿用 `safePart`（trim → 非法连续段替 `_` → 去首尾 `._-` → 前 80 字符）。
- **谁写**：DSH 壳内 agent 用首轮唤醒载荷给的记忆文件路径自己读、自己改；插件不注入正文、
  不解析回复、不代写。面板走 `/api/persons` 与 `/api/targets/profile` 读写同一批文件，
  写人物档案带 `base_mtime`（不一致回 `stale`，不覆盖 agent 刚写的内容）。
  `dsh.full_access=true` 时插件把会话切到 `danger-full-access`，否则 `workspace-write`
  会拒绝写工作区外的画像目录。
- **上限与整理**：每份软 8KB / 硬 12KB（超限拒写、不截断），目录 700、文件 600、
  临时文件 + rename；`历史结论` >20 条或日期流水 >8 条时必须整理，缩小时旧全文归档到
  `<文件>.history.md`。
- **索引**：`env.json` 只读，独立形态单聊目标的 `profile_file` 也指向人物档案；不写人物索引。
  `target` 标记的服务对象一定有记忆文件，但不一定有单独的工作本。
- **删除与迁移**：`DELETE /api/forget` 只删旧工作本与会话状态，人物档案跨会话保留；
  删人物走 `DELETE /api/persons`。旧私聊工作本在新版第一次被碰到时整文件搬进人物档案，
  已有档案时留给 agent 按载荷合并归档；旧群画像懒拆分（旧全文归档 `.history.md`，
  确认不了 ID 的条目留在工作本 `## 待归人物`）。

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
                         └── blocked=1 ─────────────────▶ 不拉、不计数、不唤醒
```

四个独立开关，别当成一个状态机去理解：

| 字段 | 取值 | 语义 | 谁改 |
| --- | --- | --- | --- |
| `target` | 0/1 | 服务对象（有记忆文件：单聊人物档案 / 群工作本） | 加入值守自动置 1 |
| `watching` | 0/1 | 用户显式加入值守 | 面板 / `/api/watch` |
| `timer` | -1 / 0 / 1 | -1 明确不拉；0 跟随默认；1 强制定时拉 | 面板 / `/api/chat/timer` |
| `blocked` | 0/1 | 屏蔽 = 不同步 | 面板 / `/api/chat/block` |

`blocked` 优先级最高：`candidates()` 先过滤，`pollChat()` 再兜一次，
所以「定时 / 点开补拉 / 手动单会话」三条路都进不来。屏蔽不删消息——
只是把该会话 `new/opened` 的待回标成 `ignored`，取消屏蔽后指针仍在。

插件壳支持 `feishu` / `wecom` / `dingtalk`，`config.platforms` 是启用开关（默认前两个）。
没启用的平台不跑 `whoami`、不轮询；存量 `dingtalk` 会话保留在 state，启用后照常拉取。

## 值守分诊：一次发现，@ 才重判

- 第一次成功刷会话列表只建 `desk.baseline_at`；那一刻已在的群是**存量**，之后不读、不分诊、
  不清查。首轮/0.18.0 升级会做一次**完整分页**（`desk.full_baseline_at`），把第一页之后的旧群
  也先登记成存量；否则旧群今天才出现会被误当新群。基线之后真正新出现的群才进 `chats[].duty`，
  第一次判一次；之后只有**新的个人 @** 才判第二次；没有 @ 不跑模型。已经在值守的群 @ 直接进群会话。
- 飞书用 `im +messages-search --is-at-me --chat-type group` 直接拉跨群 @我，一条搜索取代
  逐群扫；`--is-at-me` 会带 @all/@everyone，插件必须再用 `isMention` 过滤。钉钉没有 @我
  搜索，退回逐新群；企微没有 mentions，不扫。细节与缺口见 `references/feishu.md`。
- 判定不放在群会话：cwd 固定 `<state.dir>/duty/`，每次判断**新建值守台会话**（一次性、无历史），
  只写 `decisions/<event_id>.json`；插件校验后执行。`policy.md` 在插件安装/启动时写入初始版本
  （缺/空才补，已有内容不覆盖），agent 可自行维护。旧值守台会话留在 DSH 历史，不删。
  群会话仍在原工作区。
- 自动开监听一律 `mention`；`duty.max_group_members`（默认 10，只数人）是硬门：超过或
  人数未知只能 `ignore`，手动可强制。**自动路径在起值守台会话前先查人数**，超限/未知直接
  ignore，不拉消息、不花 token。已经在值班的群后来变大不自动停。常见原因：
  DingTalk/WeCom 没有成员列表，自动只能忽略；飞书 `truncations[]` 也按未知。

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
全量监听，既贵又不合适。真要做群客服，把那个群的关注程度切到「只盯 @我」或「全部消息」，
它才进轮询（进去也会按 `fast_sec` 拉，一天约 1440 次，体检页有估算）。

私聊的「只认 @」只决定**叫不叫醒**，不决定拉不拉：仍按 `fast_sec` 拉，否则连 @ 也发现不了。
非 @ 消息记 `fyi` / `ignored`，正文不落盘、不算待回，因此闲聊不花 turn、也不占计数。

## 消息分类与去重

| kind | 判据 | 算待回 |
| --- | --- | --- |
| `dm` | 单聊里别人发的（私聊「只认 @」时仅 @ 我的那条） | ✅ |
| `mention` | 群里 @我（匹配 `self_names`） | ✅ |
| `fyi` | 群里没 @我 / 私聊「只认 @」时的非 @ 消息，但会话在盯 | ❌（只在 `/api/inbox?filter=all` 里） |
| `out` | 我自己发的（防回环），不含 @ 自己的指令 | ❌ |
| `cmd` | 我自己 @ 自己（私聊或群聊，对替身说话，spec 0029 / 0039） | ❌（只在 `/api/inbox?filter=all` 里） |

分类在 `poller.process()` 里**只判一次**，判完写进 `recent`，前端不再重算。
去重靠 `msg_id` + `last_msg_id`：消息按最新在前遇到水位 ID 停止，同秒多条不再漏；
水位掉出拉取窗口时回退 `last_epoch`。同一批里出现本人消息时，更早的待回直接标 `replied`
（本人 @ 自己的指令除外：下指令不等于已经回复了对面）。

**待回闭环**：拉取时看到本人（或 agent 代发）的新消息，会把该会话里
**严格早于**它的待回标成 `replied`——不会留下永远消不掉的「待回」。
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

## 待回聚合（`inbox`）

`state.inbox()` 与 `/api/inbox` 从 `recent` 现算，不落第二份索引：按 `(platform, chat_id)`
聚合，`count` = 该会话命中的条数，`unread` = 其中 `new`，排序键是会话最后一条消息时间。
每组带 3 条预览；`?group=msg` 退回逐条模式（排障用）。屏蔽会话在派生时直接排除。
面板自 spec 0032 起不再渲染收件箱页；这份派生仍供 `/api/status` 计数、`/api/thread`
与排障使用，接口形状见 `docs/specs/contracts/01-api.md`。

## 迁移策略

一次性脚本 `node scripts/migrate-state.mjs`：读旧 `panel.db` 的 chats +
每会话最新 10 条消息 + `panel.json` 配置 + `env.json` 目标索引，写 `state.json`；
旧库改名 `panel.db.migrated`，运行期不再读 SQLite。

原则：**迁移只能放宽，不能改变行为**。存量群 `timer=0`（旧语义=不拉）统一成 -1；
私聊保留原 timer；`blocked`/`watching`/工作区/DSH 会话原样搬；正文按新规则清理。
一次升级让用户突然多出几十个群的轮询，是不可接受的。
字段以 `docs/specs/contracts/02-storage.md` 为准，测试会拿真实 `State` 对账。
