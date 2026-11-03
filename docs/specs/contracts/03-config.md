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
| `platforms` | `["feishu", "wecom"]` | 平台名数组 | 插件壳只接受 `feishu` / `wecom`；其他值被忽略，存量钉钉会话保留但不拉取 |
| `dsh.timeout` | `600` | 30–3600 秒 | 单轮 live turn 最长等多久；超时按失败处理并取消 |
| `dsh.full_access` | `false` | true / false | 为 true 时把值守会话切到 DSH 内置 `danger-full-access`，agent 可直接写 `~/.im-standin/profiles`；默认关闭，开启后 agent 能写整个 home |

> 退役：`llm.*`、`reply.*`、`reply_guard`、`ui.*`、`seed_targets`、`dsh.profile`、
> `dsh.pre_draft` 不再有消费者，`normalizeConfig()` 直接丢掉；老 `panel.json` 里残留不影响行为。
> 插件不跑 headless，也不再需要单独的 profile。

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
| `dsh.timeout` | 30 | 3600 |

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
| `port` | — | 丢掉：插件不监听端口，老配置不能把它带回来 |

## 红线

- 插件不存模型凭据：模型/网关/key 全部由 DSH 自己的配置解析，`state.json` 里没有 `llm.*` 可泄露。
- 配置里没有监听端口；`port` 属于退役键，不会被重新启用。
- 不许往仓库里写任何真实凭据；`scripts/gate.sh` 有密钥扫描（`sk-` / `ghp_` / `AKIA` / 长 base64）。
