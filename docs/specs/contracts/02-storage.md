# 契约 02 · 存储

> **冻结契约**。字段集合由 `tests/test_docs.py` 拿真实 `State` 归一化出来的对象逐键对账。
> 加字段、删字段、改语义都要同 commit 改这里。
>
> 位置：`~/.im-standin/state.json`（一个文件，0600；目录 0700）。
> 原子写：临时文件 + rename，保留 `state.json.bak`。一个 DSH 宿主进程写，不加跨进程锁。
> 不建 SQLite、不存发送历史、不存完整消息历史。

## 顶层

| 键 | 类型 | 说明 |
| --- | --- | --- |
| version | number | 状态格式版本，当前 1 |
| config | object | 见契约 03 |
| paused | bool | 暂停定时轮询（不影响在飞 turn） |
| runtime | object | `cycles` / `last_cycle_at` / `last_cycle_ms` / `last_result`；给体检页显示，丢了不影响值守 |
| chats | object | `"<platform>:<chat_id>"` → 会话对象 |

## chats 里的会话对象

| 键 | 类型 | 说明 |
| --- | --- | --- |
| platform | string | `feishu` / `wecom` / `dingtalk` |
| chat_id | string | 平台会话 ID；单聊可能是对方 userid |
| name | string | 展示名；服务对象重名时自动加 ` (2)` 后缀，保证面板按名字保存画像不串对象 |
| kind | string | `p2p` / `group` |
| target | bool | 1=服务对象（有画像文件）；加入值守即置 true |
| watching | bool | 1=值守：新消息唤醒 agent |
| blocked | bool | 1=屏蔽：不拉、不进收件箱、不计未读 |
| blocked_at | number | 屏蔽时刻（epoch 秒）；取消屏蔽归 0 |
| timer | number | 定时拉：-1 明确不拉 / 0 跟随默认 / 1 强制拉；群默认 -1 |
| wake_mode | string | 群唤醒策略：`mention`=只 @ 唤醒（默认，等同老行为）/ `all`=非 @ 也进批次（只看不回）；私聊恒为 `mention`，不读 |
| last_wake_at | number | 上一次成功唤醒的墙钟时刻（epoch 秒）；`all` 模式用它做合并窗口，失败不写 |
| last_wake_epoch | number | 上一次唤醒批次里最大的 `ts_epoch`；`all` 模式按它去重，同一批不会投递两次 |
| workspace | string | 显式绑定的工作区路径；空=未绑定，turn 跟随 DSH 默认工作区 |
| dsh_session | string | 这通会话在 DSH 里的 session id；空=还没跑过 |
| session_turns | number | 当前 dsh_session 上累计跑完的 turn 数；换会话时归 0 |
| session_bound_at | number | 当前 dsh_session 的绑定时刻；换会话时重置 |
| last_epoch | number | 水位：已处理到的最新消息 epoch；无 `last_msg_id` 时新消息必须严格大于它才算 batch |
| last_ts | string | 最后一条消息的平台时间戳（原样字符串） |
| last_msg_id | string | 水位：已处理到的最新消息 ID；有它就按 ID 收口（同秒多条不漏），掉落拉取窗口时回退 `last_epoch` |
| last_sync | number | 最后一次成功同步时刻（也用于 20 秒冷却） |
| last_error | string | 最后一次错误（成功时清空） |
| last_turn | object | `ok` / `reason` / `at`；重启时未完成的 turn 记为 `restarted` |
| wake | object | `at` / `failed` / `turn_id` / `active`；失败的下一轮重试，成功但未回复不重喊 |
| added_at | number | 入库时刻 |
| recent | array | 最近消息指针，最多 10 条，最新在前；字段见下 |
| prompt_session | string | 已消费过唤醒载荷的 DSH session id；用于判断首轮是否带完整上下文（`/cyber-im-avatar`、chat_id、运行形态、画像路径），之后只追加消息行 |

## recent 里的一条消息

| 键 | 类型 | 说明 |
| --- | --- | --- |
| msg_id | string | 平台消息 ID；企微无 ID 时是复合指纹 |
| sender_id | string | 发送者 ID |
| sender_name | string | 发送者展示名 |
| content | string | 正文；仅 `new` / `opened` 的非 `out` 消息保留，其余为空（mention 模式下群里的 `fyi` 恒为 `ignored`，实际不会多存）|
| ts | string | 平台时间戳原样 |
| ts_epoch | number | 归一 epoch |
| kind | string | `dm` / `mention` / `fyi` / `out`（`service` 仅存量数据） |
| state | string | `new` / `opened` / `replied` / `ignored` |
| msg_type | string | 平台消息类型（`text` / `image` / `file` / `post` …）；老数据缺省为空 |
| app_link | string | 平台提供的“在 IM 客户端打开”链接（飞书 `message_app_link`）；没有为空 |
| media_id | string | 平台结构化媒体键（企微 `media_id`；飞书从 content 解析出的 `img_`/`file_` key，多个逗号分隔） |
| media_paths | array | 插件下载后的本地绝对路径；只在命中唤醒时写入，清理失效文件时回写 |

老 state 缺字段时按默认补：`last_msg_id` 为空串、`msg_type` / `app_link` / `media_id` 为空串、
`media_paths` 为空数组；不改变存量会话行为。

待回口径：`dm` / `mention` / `service`，以及 `wake_mode="all"` 群里的 `fyi`；`isPendingMessage()` 一处定义，`pendingCount` / `pendingMessages` / `counts()` 共用。

正文清理：`setMessageState(..., replied|ignored)`、`markEarlierReplied()`、
`chatBlock()`、`ignoreUnwatched()` 都会把 `content` 置空。指针行不按时间删除——
消息再次进入拉取窗口时还要靠 `msg_id` 去重，否则会被当成新消息重新进收件箱。
超过 10 条时只留最新 10 条，更早的正文去平台在线查。

## 画像文件

不在 `state.json` 里：`~/.im-standin/profiles/<platform>/<chat_id>.md`，一个对象一份。
目录 700、文件 600，写入走临时文件 + rename；上限 12KB，超限拒绝而不是截断。
`env.json` 只读，提供平台 CLI 路径/登录身份；target 的画像正文不写回 `env.json`。

## 一次性迁移

`node scripts/migrate-state.mjs` 把旧 `panel.db` 的 chats + 每会话最新 10 条消息 +
`panel.json` 配置 + `env.json` 目标索引搬进 `state.json`；旧库改名为
`panel.db.migrated` 保留，运行期不再读 SQLite。`--fresh` 空状态启动，`--force` 才覆盖已有 state。

## 迁移规矩

- 新字段必须有默认值，且不改变存量会话行为（例：存量群 `timer=-1`，升级后不会突然开始轮询）。
- 旧状态里缺失的字段由 `State.load()` 补默认值；损坏时先读 `.bak`，不静默清空。
- `recent` 超过 10 条时裁掉最旧的；正文是否保留只看 `state` 与 `kind`，不按时间兜底。
- 与 `docs/architecture/02-data.md §数据形状` 保持一致；那篇讲为什么，这篇讲是什么。
