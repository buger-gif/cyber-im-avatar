# 0006 手动唤醒（现在处理）

> 状态: 实施中
> 编号: 0006
> 版本: 0.1.0
> 关联: `docs/specs/contracts/01-api.md`、`docs/specs/archive/0004-skill-shell.md`

## 背景

第一次真实验证时发现两件事：

1. 示例对象 A会话里有 29 条「待回」，但本人 16:42 已经回过，真正没回的只有 16:53 一条。
   原因是首轮回填时消息按「最新在前」处理：本人 16:42 的回复先入库并触发
   `mark_replied_before`，更早的对方消息这时还没插入，随后被当成新待回留下。
2. 0004 只在「有新消息」时唤醒 agent；已经积压、但暂时没有新消息的会话没有
   手动入口，验证和日常补跑都只能等下一轮或再收一条消息。

## 目标与非目标

- 目标：
  - 同一批里出现本人发言时，比它更早的对方消息直接标 `replied`，不进 batch；
  - 新增 `POST /api/chat/wake`：把最新待回（默认 10 条，最多 20）交给 agent；
  - 会话详情在「值守中 + 空闲 + 有待回」时显示「现在处理」。
- 非目标：
  - 不改变「新消息自动唤醒」的语义与节奏；
  - 不自动发送、不绕过 skill 的确认铁律；
  - 不做批量清理所有会话的待回；「现在处理」只作用于当前会话；
  - 不改表结构、配置键。

## 方案

### 1. 回填闭环修正（poller）

`poll_chat` 在遍历前先算本批 `self_epoch = max(本人消息 ts)`；遍历时：

- `不是本人 && ts < self_epoch` → 入库仅作上下文，状态直接 `replied`（群 fyi 用
  `ignored`），**不进 batch、不 emit message**；
- 其余逻辑不变。

这与既有的 `mark_replied_before` 语义一致，只是覆盖「更早的消息在同一批里还没
入库」这个顺序问题。

### 2. 手动唤醒（API + UI）

```http
POST /api/chat/wake  {"platform":"feishu","chat_id":"oc_…","limit":10}
```

- 校验：会话存在、未屏蔽、`watching=1`；turn 在飞返回 `running`；
- 取 `store.pending_messages(limit)`（时间正序的最新 N 条）；
- `turns.wake(...)`，返回 `{ok, pending, state}`；
- 没有待回返回 `empty`。

UI：会话详情头部在 `watched && !running && pending>0` 时显示「现在处理」，
成功后 toast「已唤醒 agent 处理 N 条待回」，随后刷新详情与会话列表。

### 3. 契约

`docs/specs/contracts/01-api.md` 的 POST 覆盖表加 `/api/chat/wake`；路由集合由
`tests/test_docs.py` 对账，代码与契约同 commit。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 等新消息自然触发 | 积压永远不处理；验证也无法用指定那条消息 |
| 清除 `last_epoch` 让旧消息重算新 | `put_message` 按 msg_id 去重，不会产生 batch；还会打乱水位 |
| 手动唤醒时把 29 条全塞给 agent | 旧消息已回过，白烧上下文；默认只取最新 10 条 |
| 在插件里直接调 lark-cli 发 | 越权；agent 的 skill 闭环与确认流才是唯一发送路径 |

## 影响面

- `service/poller.py`：batch 内本人发言的覆盖逻辑。
- `service/server.py`：`api_chat_wake` + `POST_ROUTES`。
- `web/panel.js`：详情「现在处理」按钮；重建 `lib/client.js`。
- `tests/test_polling.py`：同批闭环、手动唤醒两条用例。
- 文档：契约 01、README、CHANGELOG、PROGRESS、当日 log。

## 验收

- [ ] 同一批 `[新消息, 本人回复, 更早消息]` → 只有新消息待回，旧消息 `replied`；
- [ ] 示例对象 A积压清理后只剩最新一条待回；
- [ ] 点「现在处理」→ turn 启动，`session_turns` 增加，agent 在绑定会话里处理；
- [ ] `running` / `blocked` / 未值守时接口拒绝且 UI 提示准确；
- [ ] `python3 -m unittest discover -s tests` 全过 + `bash scripts/gate.sh --quick` 全绿。

## 风险与回滚

- 手动唤醒仍走同一 TurnManager，打断/锁/超时逻辑不变；
- 若 agent 误判「历史已约定全自动」而直接发送，属于 skill 确认流的风险，不改插件闸门；
- 回滚：删按钮与路由即可，poller 的闭环修正可单独保留（它修的是错误数据）。
