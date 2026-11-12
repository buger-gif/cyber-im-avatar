# 契约 01 · API

> **冻结契约**。路由集合由 `tests/test_docs.py` 与 `dsh-plugin/lib/app.js` 的
> `ROUTES` / `POST_ROUTES` / `DELETE_ROUTES` 逐条对账：多了、少了、改名了都会红。
> 加路由必须同 commit 改这里。
>
> 传输是 DSH 自己的同源路由 `/plugins/im-standin`，插件不监听任何端口。
> 浏览器请求直接进宿主进程里的 `App.handle()`，没有 stdio 子进程。

## 读接口（GET）

| 方法 | 路径 | 主要入参 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | 存活探针，带 pid 与 `transport=node` |
| GET | `/api/status` | — | 总状态：counts、poll、platforms、dsh、instances、turns、running。`platforms` 恒为三项（feishu / wecom / dingtalk），每项带 `enabled`；未启用的不跑 `whoami` |
| GET | `/api/inbox` | `filter`、`limit`、`group` | 待回聚合；默认按会话聚合，`group=msg` 逐条；只从每会话最近 10 条派生（面板自 spec 0032 起不再展示） |
| GET | `/api/inbox/cleanup` | — | 把未值守会话的待回批量标成 ignored |
| GET | `/api/thread` | `platform`、`chat_id`、`fetch`、`limit` | 会话正文：默认在线拉 30 条；`fetch=1` 先补拉分类（**只读，不唤醒**；冷却中直接用本地指针）；失败回退本地 10 条并带 `offline` / `error` |
| GET | `/api/chats` | — | 会话清单，含 `blocked` / `timer` / `timed` / `watching` / `wake_mode` / `send_mode` / `mentionable` / `dsh_session` / `session_turns` / `turn_state` / `duty`；`send_mode` 是该值班实际生效的 `draft` / `auto`；`mentionable=false` 表示该平台判不了 @（面板置灰「只盯 @我」）。工作区字段见下 |
| GET | `/api/duty` | — | 值守候选：`enabled`、`counts`（排队/判断中/试用/失败/忽略/值守/复核 + 配额与上限）、`desk`（session_id/workspace/session_turns/session_max_turns/last_turn/last_error/baseline_at/full_baseline_at/last_sweep_at）、`last_sweep`、`items`（每个非 none 的会话 + duty） |
| GET | `/api/send` | `platform`、`chat_id`、`text`、`msg_id` | 以本人身份发出；不写发送历史 |
| GET | `/api/state` | `platform`、`msg_id`、`state`、`chat_id` | 改最近 10 条里的一条：new / opened / replied / ignored；更早的返回 `not_cached` |
| GET | `/api/watch` | `platform`、`chat_id`、`watching`、`name`、`kind`、`workspace` | 加入 / 移出值守；`workspace` 非空时一并绑定，空串不改变已有绑定。加入时把 `timer` 拉回 1（去掉「不盯」留下的 `-1`，否则看着在盯其实不拉），`wake_mode` 沿用上次设置；群首次加入默认 `wake_mode=mention`（只盯 @我），私聊默认 `all`（每条都唤醒）；会话还没有显式发送方式时，把 `send_mode` 固化为当前的 `send_mode_default`。要改关注程度得显式调 `/api/chat/mode`，改发送方式调 `/api/chat/send-mode`。**加入即开会话**（新加入或绑定会话缺了才开；已经盯上且有会话不重复开场）：补拉一次（`wake=false, force=true`，不推进水位）后起一轮开场 turn；失败不影响值守，只在返回的 `open: {ok, reason, skipped}` 里说明（真的在飞时 `skipped="running"`；已取消正在收尾的旧轮不算） |
| GET | `/api/unwatch` | `platform`、`chat_id` | 移出值守（保留目标与最近指针） |
| GET | `/api/search` | `platform`、`q` | 在线搜人；每条含 `id`、`chat_id`（可空，飞书为 `p2p_chat_id`）、`name`（仅可读名称）、`department` |
| GET | `/api/search/chats` | `platform`、`q` | 按名字搜会话（找群用）；`name` 为空时表示没有可读群名，不回退 `chat_id` |
| GET | `/api/chat/timer` | `platform`、`chat_id`、`timer` | 定时拉开关：-1 / 0 / 1；群默认 -1 |
| POST | `/api/chat/mode` | `platform`、`chat_id`、`mode`、`name`、`kind` | 关注程度一档三态：`off` / `mention` / `all`，写 `watching` / `timer`，开启时同时写 `wake_mode`；群 `mention`=只 @ 唤醒、`all`=非 @ 也进批次；私聊 `mention`=只认 @、`all`=每条都唤醒。`off` 会取消在飞 turn，但**不改写 `wake_mode`**（下次开启沿用上次；重新加入值守也不会静默变只认 @）；`mentionable=false` 的平台私聊选 `mention` 返回 `{ok:false}`；关闭 → 开启（或开启时没有绑定会话）同样立刻起一场开场 turn，返回 `open` |
| GET | `/api/chat/block` | `platform`、`chat_id`、`blocked` | 屏蔽 / 取消屏蔽（屏蔽即不同步） |
| GET | `/api/poll` | `platform`、`chat_id` | 立即拉一轮；带会话=只拉它并同步返回，不带=后台跑整轮，结果从 `/api/status` 的 `poll.last_result` 读。受 `cooldown_sec` 约束；post-turn 补拉是唯一 `force` 例外 |
| GET | `/api/pause` | `paused` | 暂停 / 恢复定时轮询（不取消在飞 turn） |
| GET | `/api/doctor` | — | 体检：身份、拉取通路、DSH 宿主、skill 路径、拉取节奏 |
| GET | `/api/config` | — | 读配置；模型/凭据全在 DSH，插件无 api_key 可回传 |
| GET | `/api/workspaces` | — | 可选工作区列表（值守会话绑定用） |
| GET | `/api/targets` | — | 服务对象列表：`profile*` = 该会话的记忆文件——群是会话工作本，单聊能推出人物 ID 时就是对方的人物档案（与 `person` 同一路径，并 ensure；旧私聊工作本在此整文件搬到人物档案）；推不出 ID 的 p2p 仍指会话工作本。`person` = `person_id` / `path` / `excerpt` / `updated_at` / `exists`，仅 p2p 有 |
| GET | `/api/persons` | `platform`（可选） | 人物档案列表：只扫 `profiles/people/`，不建文件；items 带 `platform` / `person_id` / `name` / `profile` / `profile_path` / `profile_updated_at` / `profile_excerpt` / `bytes` / `chat_ids`（`[{platform, chat_id, name}]`） |
| GET | `/api/chat/workspace` | `platform`、`chat_id`、`workspace`（别名 `path`） | 给值守会话绑 / 解绑工作区；必须显式给键，空串=解绑。工作区变了且旧会话因此解绑、会话又在值守中（未屏蔽）→ 立刻在新工作区开新会话，返回 `open` |
| GET | `/api/chat/session` | `platform`、`chat_id` | 查当前绑定的 DSH 会话与工作区 |
| GET | `/api/logs` | — | `{sends, errors, turns, events}`：`errors`=最近 20 条轮询错误；`turns`=在飞快照；`events`=最近 80 条 turn 事件（落盘 `~/.im-standin/logs/turns.jsonl`，只有事件/ID/耗时/原因，无正文） |
| GET | `/api/digest` | `date`（`YYYY-MM-DD`，默认今天） | 只读 `~/.im-standin/digest/<date>.md`（agent 维护）：`{ok, date, exists, text, mtime}`；日期非法 `bad_date`；不建目录、不解析、不统计 |

### `/api/chats` 的工作区字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workspace` | string | 显式绑定；空串=跟随 DSH 默认 |
| `workspace_title` | string | 显式绑定的展示名（空绑定为空） |
| `workspace_in_dsh` | bool | 显式路径是否在 DSH 登记表里 |
| `workspace_exists` | bool | 显式路径是否还在（空绑定为 false） |
| `workspace_effective` | string | 实际会用的 cwd（显式或 DSH 默认） |
| `workspace_effective_title` | string | 上面的展示名 |
| `workspace_fallback` | bool | true=未显式绑定，跟随 DSH 默认 |
| `workspace_missing` | bool | true=显式绑定的目录已不存在（turn 会明确失败） |

## 写接口（POST 覆盖）

`POST` 默认回落到 `ROUTES` 里同名 handler；下列路径有**独立的写入实现**，必须走 `POST_ROUTES`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/config` | 写配置；`poll.interval_min` 夹到 ≥10；`send_mode_default` 只接受 `draft` / `auto`，非法值回 `draft`（只影响之后新加入值守的会话） |
| POST | `/api/platforms` | 启用 / 停用平台：入参 `platform`、`enabled`；只接受 `feishu` / `wecom` / `dingtalk`，写回 `config.platforms`（按固定顺序去重） |
| POST | `/api/targets/profile` | 覆盖写该会话的记忆文件：p2p 写人物档案（同一份，不另存工作本），群写会话工作本；入参 `platform`、`chat_id`（优先）/`name`（兼容旧面板）、`text`（≤12KB，超限拒绝不截断） |
| POST | `/api/persons/profile` | 覆盖写人物档案；入参 `platform`、`person_id`、`name`、`text`（≤12KB）、`base_mtime`（可选）；mtime 更新过则回 `{ok:false, reason:"stale"}` 不写 |
| POST | `/api/chat/session/reset` | 重开会话：可带 `workspace` 先落工作区；打断在飞 turn、清空 `dsh_session`；值守中（未屏蔽）立刻在新会话里跑一轮开场，返回 `open: {ok, reason, skipped}`；未值守 / 屏蔽只解绑 |
| POST | `/api/chat/wake` | 手动唤醒：可带 `workspace` 先落工作区；把该会话最近待回交给 agent，不等新消息；`running` / `blocked` / 未值守时拒绝 |
| POST | `/api/duty/triage` | 手动让值守台判断：入参 `platform`、`chat_id`、`force`；只接受未值守、未屏蔽、非 queued/triaging；写 `trigger=manual` 的新事件，下一次 tick 起分诊 turn；`force` 可重排 ignore/failed，关闭自动分诊时也允许手动 |
| POST | `/api/chat/send-mode` | 值班单点发送方式：入参 `platform`、`chat_id`、`mode`（`draft` / `auto`）；写 `chats[].send_mode`，返回 `{ok, send_mode, chat}`；会话不存在回 `not_found`。这个值不会被之后改 `send_mode_default` 覆盖 |

## 删除接口（DELETE）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| DELETE | `/api/forget` | 删除该会话的状态与旧版会话工作本；人物档案跨会话保留（p2p 的记忆就是它，不删）；不删线上消息，也不删 DSH 会话文件 |
| DELETE | `/api/persons` | 删除一份人物档案（显式操作）；入参 `platform`、`person_id` |

## 值守决策文件协议

agent 只写 `<state.dir>/duty/decisions/<event_id>.json`，插件读、校验、应用、删除；不解析 agent 的自然语言。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `version` | 否 | 缺省 1；不是 1 拒绝 |
| `decision_id` | 是 | 必须等于本次事件的 `event_id` |
| `platform` / `chat_id` | 是 | 必须与候选一致 |
| `action` | 是 | `watch` / `trial` / `ignore`；复核只允许 `watch` / `ignore` |
| `reason` | 是 | 单行 1–160 字；插件去控制字符 |
| `confidence` | 否 | 0–1，缺省 0.5 |
| `review_at` | 否 | trial 可给 epoch 秒，夹到 `[now+1h, now+trial_hours]` |
| `mode` | 否 | 只允许缺省或 `mention`；`all` 一律拒绝（`all_disabled`） |

硬门：平台判不了个人 @ → 只能 ignore；群成员数 > `duty.max_group_members` 或未知 → 只能 ignore；达 `duty.max_groups` → 只能 ignore；`trial_hours=0` → 拒绝 trial。用户手动入口不受这些自动硬门限制。坏 JSON / 错 id / 错 chat / 未知 action → 不应用，记 `failed` + `error`，不抛异常。

## 约定

- **入参位置**：`GET` 走 query string，`POST` / `DELETE` 走 JSON body；同名键含义一致。
- **返回值**：一律 JSON 对象；写操作成功带 `{"ok": true}`，失败带 `{"ok": false, "reason": "…"}`。
  路由不存在给 404，handler 抛异常给 500。
- **敏感字段**：插件不持有模型 key；错误信息进 `poller.errors`/状态前要过平台适配层的脱敏。
- **新增路由的顺序**：先改本文件 → 改 `dsh-plugin/lib/app.js` 的 `ROUTES` /
  `POST_ROUTES` / `DELETE_ROUTES` → 面板接上 → 跑 `bash scripts/gate.sh --quick`。
