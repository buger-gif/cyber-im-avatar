# 0046 实施计划

> 关联: `docs/specs/active/0046-自at关键词启动值班.md`
> 原则：先落纯函数与配置，再接通轮询 / 搜索，最后做面板和文档；每一步都有可跑的验证。

## 1. 关键词与配置

- [x] 新增 `dsh-plugin/lib/command.js`：`normalizeKeyword` / `commandEnabled` /
      `stripMentions` / `isStartCommand` / `commandRow`。
- [x] `DEFAULT_CONFIG.command = { enabled: true, start_keyword: "启动" }`；
      `normalizeConfig()` 归一开关与关键词；`POST /api/config` 合并 `command`，
      启用 + 空关键词 / 超长整次拒绝。
- [x] `chats[].command` 的默认值、枚举与归一化进 `normalizeChat()`。
- 验证：`node --test tests/state.test.mjs tests/app.test.mjs`。

## 2. 飞书跨会话搜索

- [x] `ADAPTERS.feishu` 增加 `cmd_self_mentions` 与 `f_at_chat_type`。
- [x] `Adapter.searchSelfMentions({ selfId, start, end })`：本人发送 + @本人，
      不限 `chat-type`，解析 `chat_id` / `chat_type` / `chat_name` / `mentions`。
- [x] `Adapter.supportsSelfMentions` 能力位。
- 验证：`node --test tests/im.test.mjs`（命令参数、字段解析、缺能力降级）。

## 3. Poller：即时识别与启动

- [x] `pollChat()` 从批次里取命中关键词的 `cmd`；命中的先消费，不再进 `maybeWake`；
      启动成功时跳过本轮其它批次（开场 turn 已带最近上下文）。
- [x] `startDutyFromCommand()`：锁、`msg_id` 幂等、屏蔽、已有会话冲突、空绑定修复、
      写入 `watching/timer/target/wake_mode/send_mode/workspace/duty/command`，再
      `turns.open()`；失败不回滚值守。
- [x] 清掉排队 / 进行中的分诊：`duty` 记 `watch/manual/user`、清 `event_id`；
      `startTriage` 在探针 / 查人数前后检查是否被接管，`finishTriage` 丢弃陈旧决策。
- 验证：`node --test tests/poller.test.mjs`（已值守冲突、未值守启动、群默认、关键词开关、
  重复消息幂等）。

## 4. Poller：1 分钟搜索扫描

- [x] `maybeCommandScan()` 每 60 秒一次，仅飞书，启用且关键词非空；最近 3 分钟、
      只取一页；结果逐条本地过滤。
- [x] 新命中的会话 `ensureChat` 后先 `pollChat({ wake:false, handleCommands:false })`
      补上下文，再走同一个启动函数；同一 `msg_id` 不重复处理。
- [x] 失败只写 `lastCommandScan` / `logger.warn`，不进错误列表刷屏。
- 验证：`node --test tests/poller.test.mjs`（p2p / group 新会话、重复扫描、搜索失败）。

## 5. 开场载荷

- [x] `buildOpenPrompt()` 支持 `dutyContext.command`：标题说明 IM 指令启动，不提值守台 /
      接手轮；明确启动指令本身不要回消息。
- [x] `turns.open()` 的 `reason` / `dutyContext` 透传，不改变面板加入与分诊接手的现有文案。
- 验证：`node --test tests/turns.test.mjs`。

## 6. 面板

- [x] 设置页新增「IM 启动指令」卡片：启用、关键词、保存、范围说明。
- [x] 会话详情展示最近一次 `command.result` 与原因。
- [x] `python3 scripts/build_client.py` 更新 `lib/client.js`。
- 验证：`python3 dsh-plugin/scripts/build_client.py` 后 `node --test tests/app.test.mjs`；
  `tests/test_docs.py` 的产物新鲜度检查。

## 7. 契约与文档

- [x] 契约 01 / 02 / 03 同步；架构 02 / 03、ADR、两份 README、SKILL、
      `references/feishu.md`、CHANGELOG、PROGRESS、当日 log、spec 下一号指针。
- [x] `scripts/doc_budgets.json` 登记新增行数。
- 验证：`bash scripts/gate.sh --quick`。

## 8. 收口

- [x] `cd dsh-plugin && node --test` 全绿。
- [x] `python3 tests/run_tests.py` 全绿。
- [x] `bash scripts/gate.sh --quick` 全绿。
- [ ] 真机（用户）：未值守飞书私聊 / 群 @ 自己 + 「启动」→ 约 1 分钟内面板出现值班；
      重复发只显示冲突，不出现第二个会话。
