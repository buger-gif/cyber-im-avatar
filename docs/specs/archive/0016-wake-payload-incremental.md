# 0016 唤醒载荷增量追加

> 状态: 已验收
> 编号: 0016
> 版本: 0.8.x
> 关联: `docs/specs/contracts/02-storage.md`
>
> 后续：DSH 插件已由 `docs/specs/active/0018-agent-owned-profile.md` 改为每次唤醒只追加
> 新消息，取消「首轮完整载荷 / 后续增量」两套模板；独立 skill 形态不受影响。

## 背景

DSH 会话里每来一条 IM 新消息，`turns.js` 都会重新组装完整唤醒载荷：`/cyber-im-avatar`
入口、平台与 chat_id、整份画像、最近 10 条消息、监听/画像说明。同一会话跑过十几轮后，
DSH 对话里会出现十几条几乎相同的巨型 user 消息，后半段全是重复内容。

用户反馈：「目前的消息插入每次都全局组装，这样太丑陋了；追加消息只发用户的新消息就行了。」

## 目标与非目标

- 目标：同一 DSH 会话的首轮仍发完整载荷；之后每次唤醒只追加本次触发的新消息。
- 目标：换会话、重置会话、或首轮载荷还没被 agent 消费就失败时，下一轮自动回到完整载荷。
- 非目标：不改轮询水位、消息分类、发送流程、画像读写与 DSH 会话绑定规则；
  不为增量载荷重新调用 skill 入口。

## 方案

### 1. 首轮完整，后续增量

`Turns` 在发送前比较 `chat.prompt_session` 与本次 `resolveSession()` 得到的 session id：

- 不一致 → `buildPrompt()` 完整载荷（现状），agent 消费到该 prompt（`user/message`
  事件匹配 prompt id）或 turn 成功时把 `prompt_session` 设为该 session id。
- 一致 → `buildDeltaPrompt()`，只渲染本次新消息：

```
值守命中 · 飞书 · 对象名 · 新消息
chat_id：oc_xxx
运行形态：DSH 插件壳；不要挂监听，不要写 ~/.im-standin。
- [10:32] 对方: 正文
```

增量载荷不含 `/cyber-im-avatar`、画像正文、最近 10 条与完整监听说明；这些已经在会话
历史里。只保留平台/对象、chat_id 与一行运行形态，避免会话被压缩后误挂监听。

### 2. 新消息的来源

- poller 命中时把 `process()` 产出的 `batch` 传给 `turns.wake(chat, { batch })`，
  增量只发这一批，不重复发此前已由 agent 看过的 pending。
- 手动唤醒 / 失败重试没有 batch，用 `state.pendingMessages(chat)`；再没有就退回完整载荷。

### 3. 新状态字段

`chats` 追加 `prompt_session: string`（默认 `""`）：

- 已消费完整载荷的 DSH session id；
- `State.setSession()` 换会话或重置时清空；
- 存量 state 缺字段按 `""` 补齐，行为是「下一轮发完整载荷」，不改变已有会话语义。

同步改 `docs/specs/contracts/02-storage.md`。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 用 `session_turns > 0` 判断是否首轮 | 首轮跑到一半被新消息打断时 turn 数仍是 0，会重复发完整载荷 |
| 后续只发 `state.pendingMessages()` | agent 看过但决定不回的 pending 会每次重发，正是用户说的「车轱辘话」 |
| 每轮都带画像路径/画像正文 | 画像最长 12KB，重复注入是本次要消掉的成本大头 |

## 影响面

- 代码：`dsh-plugin/lib/turns.js`、`dsh-plugin/lib/state.js`、`dsh-plugin/lib/poller.js`
- 契约：`docs/specs/contracts/02-storage.md`
- 用户可见：DSH 会话里首轮之后只出现新消息，不再重复整份载荷
- 兼容：老 `state.json` 无 `prompt_session`，按空值处理；已有会话下一轮先发一次完整载荷

## 验收

- [x] 同一会话第二次唤醒 → 第二次 followup 只含新消息，不含画像与「最近 10 条」
- [x] 新消息在首轮运行中到达 → 取消旧 turn 后仍只追加新消息
- [x] 换会话 / 重置会话后的第一次唤醒 → 重新发完整载荷
- [x] 首轮 prompt 未被消费（无 `user/message`）→ 下一轮仍发完整载荷
- [x] 手动唤醒无 batch → 用 pending 消息生成增量；无 pending 时退回完整载荷
- [x] `node --test`、`bash scripts/gate.sh --quick` 全过

## 风险与回滚

- 风险：DSH 会话历史被用户手工清空后，增量载荷缺少画像上下文；skill 仍可用历史里的
  完整载荷与画像文件兜底。
- 回滚：撤掉 `prompt_session` 判断即回到每轮完整载荷；旧 state 字段可留可删。
