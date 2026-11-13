# 契约 03 · 配置

> **冻结契约**。键集合与默认值由 `tests/test_docs.py` 与 `dsh-plugin/lib/state.js` 的
> `DEFAULT_CONFIG` 对账；取值范围用 `normalizeConfig()` 的极端值夹取结果对账。
> 加键必须同 commit 改这里，否则测试红。
>
> 文件：`~/.im-standin/state.json` 的 `config` 字段（0600）。
> 老 `panel.json` 只在一次性迁移时读，运行期不再读它。

## 键与默认值

默认值写成 JSON 字面量（`10` / `"recent"` / `true` / `["feishu", "wecom"]`），可被解析比对。

| 键 | 默认 | 取值 | 说明 |
| --- | --- | --- | --- |
| `poll.interval_min` | `10` | 整数 10–240 | 慢车道：会话发现与 `whoami` 的间隔（分钟），也是快车道的上限。低于 10 一律抬到 10 |
| `poll.fast_sec` | `60` | `0` 或 20–600 | 快车道：只拉值守候选的间隔（秒）；`0` = 关闭，退回单一慢车道；不超过 `interval_min*60` |
| `poll.dm_scope` | `"recent"` | `recent` / `all` / `watched` | **legacy no-op**：只为老配置可加载；候选规则固定为只看 `watching` 私聊 |
| `poll.dm_recent` | `20` | 1–200 | 会话列表扫描条数；飞书 `--page-size` 实际夹到 100 |
| `poll.per_chat_limit` | `10` | 1–50 | 单会话每轮拉多少条；飞书走原生 `--limit`，企微只有时间窗、拿到后客户端截断；本地仍只留最新 10 条 |
| `poll.backfill_hours` | `72` | 0–720 | 首次见到会话时的回看窗口；企微 `fetchThread` 用它（上限 7 天），飞书没有时间回看参数、不传 |
| `poll.refresh_chatlist` | `true` | true / false | 每轮刷一次会话列表（只取元数据） |
| `poll.cooldown_sec` | `20` | 0–600 | 点开 / 手动 `/api/poll` 都生效，防连点；post-turn 补拉例外 |
| `poll.group_wake_sec` | `60` | 0–3600 | `wake_mode="all"` 的群合并窗口（秒）：窗口内到达的消息攒着，一次唤醒全给；`0` = 不合并。快车道仍是 60 秒一轮，所以默认值等价「每分钟最多一次」 |
| `platforms` | `["feishu", "wecom"]` | 平台名数组 | 插件支持 `feishu` / `wecom` / `dingtalk`；缺省只开前两个，其他值被忽略。启用的平台才跑 `whoami` 与轮询；加入某平台值守会自动启用它 |
| `send_mode_default` | `"draft"` | `draft` / `auto` | **新建值守**的默认发送方式。`draft`=草稿审批（默认）：agent 把回复留在 DSH 会话等用户说「发」；`auto`=全自动：agent 对「该回的消息」直接以本人身份发出。只决定之后新加入值守的会话如何初始化；已有值班的 `chats[].send_mode` 不被覆盖（见 `docs/specs/contracts/02-storage.md`）。缺省/非法一律回 `draft` |
| `join_workspace` | `""` | 空或存在的绝对路径 | 面板「加入值守时绑定工作区」选择的持久化副本。自动分诊判定 `watch` / `trial` 后，给新值班会话按它落 `chats[].workspace`（已有显式绑定的不覆盖）。空 = 未显式选择：先取现有会话「最近在用」的工作区，再回落 DSH 默认。`POST /api/config` 对非空路径做真实目录校验，不存在则整次拒绝、不落库 |
| `command.enabled` | `true` | true / false | 「本人 @ 自己 + 关键词 = 在当前会话启动值班」总开关（spec 0046）。关闭后自 @ 仍按普通 `cmd` 唤醒，不启动值班、不扫描 |
| `command.start_keyword` | `"启动"` | 1–20 个字符；空串 = 关闭 | 启动关键词。去掉首尾空白、压缩空白、去控制字符后匹配；ASCII 大小写不敏感。设置接口拒绝超长与「启用 + 空关键词」，不静默截断 |
| `command.reply_enabled` | `true` | true / false | 启动指令真正拉起新值班后，在该会话回一条纯文本回执（spec 0048）。只有 `result=started` 才发；`already` / `blocked` / `failed` 不发。关闭或文案为空都不发 |
| `command.reply_text` | `"支持用户自定义，默认就是 24 小时值班，上线 @ 我即可触发。"` | 0–200 个字符；空串 = 不发 | 启动回执文案。去掉控制字符、压缩空白后发送；设置接口拒绝超长，不静默截断 |
| `dsh.timeout` | `600` | 120–3600 秒 | **停滞**超时：这么久没有收到该会话的任何 `session/event`（工具/模型都没动静）才按卡死取消；有活动会不断重置，长任务不会被墙钟切掉 |
| `dsh.turn_cap_sec` | `3600` | 0–86400 秒 | 单轮总时长兜底（从 turn 开始算，不随活动重置）；超时按失败处理并取消，`last_turn.reason` 记 `turn_cap`；`0` = 不设上限 |
| `dsh.full_access` | `false` | true / false | 为 true 时把值守会话切到 DSH 内置 `danger-full-access`，agent 可直接写 `~/.im-standin/profiles`（人物档案；群还有会话工作本）；默认关闭，开启后 agent 能写整个 home |
| `dsh.warm_min` | `55` | 0–1440 分钟 | 会话寿命的唯一时钟：闲置达到这么久先跑**一次**保温轮（续上下文缓存 + 按 skill 归并载荷列出的记忆文件：单聊一份人物档案，群工作本与人物档案）；再过一个同样长的周期仍没有真实消息，下一条消息换新会话。真实消息会重新计时；`0` = 关闭保温，同时关闭自动换会话 |
| `duty.enabled` | `true` | true / false | 自动分诊总开关；关闭后不发现新群、不自动复核；手动仍可 |
| `duty.trial_hours` | `0` | 0–168 小时 | 试用时长；0=关闭（严格两段式），只能 watch/ignore；>0 才允许 trial |
| `duty.max_groups` | `20` | 0–200 | 自动开监听的值守群上限；0=不限；手动不受限 |
| `duty.max_per_day` | `20` | 0–200 | 每天自动分诊 turn 上限；0=不限；复核与手动不占 |
| `duty.session_max_turns` | `20` | 0–200 | 已废弃：值守台每次判断新建会话；保留读取兼容，不再生效 |
| `duty.record_keep_days` | `30` | 0–365 天 | ignore/failed 记录保留；0=永不清；watch/trial 不清 |
| `duty.sweep_min` | `10` | 0 或 10–1440 分钟 | @ 清查间隔；0=关；>0 时最小 10 |
| `duty.sweep_lookback_hours` | `24` | 1–168 小时 | 清查回看窗口；更早不自动补 |
| `duty.max_group_members` | `10` | 0–1000 人 | 自动开监听的群成员上限（只数人）；超过/未知只能 ignore；0=不限；手动不受限 |
| `dsh.ack_reaction` | `true` | true / false | 命中回执：本轮载荷已送进 DSH 会话后，用 `lark-cli` 给本批 @ 你的消息点一个 `Get` 表情（表情回复，不是新消息）；只认群的 `mention` 与私聊「只认 @」模式下的 `dm`，`cmd` / `out` / `fyi` 不点。仅飞书；企微 / 钉钉没有反应命令，静默跳过。关闭后不调用 CLI |

> 退役：`llm.*`、`reply.*`、`reply_guard`、`ui.*`、`seed_targets`、`dsh.profile`、
> `dsh.pre_draft`、`dsh.idle_reset_min` 不再有消费者，`normalizeConfig()` 直接丢掉；老
> `panel.json` / `state.json` 里残留不影响行为。插件不跑 headless，也不再需要单独的 profile。

## 取值范围（夹取，不是报错）

非法值不会让配置加载失败，只会被夹回区间——面板上填错数字不该导致值守停摆。

| 键 | 下限 | 上限 |
| --- | --- | --- |
| `poll.interval_min` | 10 | 240 |
| `poll.fast_sec` | 0 | 600 |
| `poll.dm_recent` | 1 | 200 |
| `poll.per_chat_limit` | 1 | 50 |
| `poll.backfill_hours` | 0 | 720 |
| `poll.cooldown_sec` | 0 | 600 |
| `poll.group_wake_sec` | 0 | 3600 |
| `dsh.timeout` | 120 | 3600 |
| `dsh.turn_cap_sec` | 0 | 86400 |
| `dsh.warm_min` | 0 | 1440 |
| `duty.trial_hours` | 0 | 168 |
| `duty.max_groups` | 0 | 200 |
| `duty.max_per_day` | 0 | 200 |
| `duty.session_max_turns` | 0 | 200 |
| `duty.record_keep_days` | 0 | 365 |
| `duty.sweep_min` | 0 | 1440 |
| `duty.sweep_lookback_hours` | 1 | 168 |
| `duty.max_group_members` | 0 | 1000 |

## 老键迁移

`normalizeConfig()` 把 0.3.0 之前的顶层配置翻译成 `poll.*`，迁完从运行配置里丢掉：

| 老键 | 新位置 | 换算 |
| --- | --- | --- |
| `poll_interval` | `poll.interval_min` | 秒换算成分钟，再夹到 ≥10 |
| `recent_chats` | `poll.dm_recent` | 原值 |
| `per_chat_limit` | `poll.per_chat_limit` | 原值 |
| `backfill_hours` | `poll.backfill_hours` | 原值 |
| `poll_watched_only` | `poll.dm_scope="watched"` | true 才生效 |
| `chatlist_interval` | — | 丢掉：会话列表改为跟着每轮走 |
| `dsh.idle_reset_min` | — | 丢掉：会话寿命改由 `dsh.warm_min` 推导（一次保温 + 第二个周期换会话） |
| `port` | — | 丢掉：插件不监听端口，老配置不能把它带回来 |
| `send_mode` | `send_mode_default` | 未发布时的临时全局键：新键缺省且有合法旧值时迁成新建默认，然后丢弃 |

## 红线

- 插件不存模型凭据：模型/网关/key 全部由 DSH 自己的配置解析，`state.json` 里没有 `llm.*` 可泄露。
- 配置里没有监听端口；`port` 属于退役键，不会被重新启用。
- 不许往仓库里写任何真实凭据；`scripts/gate.sh` 有密钥扫描（`sk-` / `ghp_` / `AKIA` / 长 base64）。
