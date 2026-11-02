# 0004 分身壳（skill 管理器）· 实施计划

> 关联: `docs/specs/archive/0004-skill-shell.md`
> 结果: 9 步全部完成（0.8.0），47 个插件测试 + gate 全绿
> 原则：一步一验证；每步都能单独回滚。

## 步骤

1. **探针（已完成，不重跑）**
   - P0 工具面 / P1 中断续用 / P2 并发写锁 / P3 无推送原语。
   - 证据在 spec 背景表。

2. **存储与配置先行（行为不变）**
   - `store.py`：chats 补 `session_bound_at` / `session_turns`（只加不删）；
     删 `REPLY_MODES` / `norm_reply_mode` / `set_reply_state`；新增
     `bump_session_turn`、`mark_replied_before`。
   - `config.py`：删 `reply.*` / `llm.*` / `dsh.pre_draft`；`dsh.timeout` 默认 600；
     `public()` 不再回传 llm 段，改为 `resolved.dsh_ready`。
   - 验证：`python3 -m unittest discover -s tests` 仅 config 相关用例需要先改（见步骤 7）。

3. **dshrun 支持打断**
   - `Turn`：Popen（`start_new_session=True`）+ 读线程解析 NDJSON
     （session / final / status / error）；`wait(timeout)`、`terminate(grace=5)`；
     识别 `already owned by an active write handle` → `locked=True`。
   - 验证：单测用假 `dsh` 脚本（echo JSON 后 sleep）验证 terminate 与结果解析。

4. **turn 管理器（新文件 `service/turns.py`）**
   - 每实例 `idle | running{turn, since}`；`wake()` 合并批次、打断重起；
     worker 线程收尾、记 `session_turns`、emit `turn_started/turn_done`；
     `snapshot()` 给 UI；`interrupt(platform, chat_id)` 给新建会话用。
   - 新 session 落库 + `attach_session` 申报沿用现机制。
   - 验证：假 dshrun 的单元测试（wake / interrupt / burst 合并 / 失败重喊）。

5. **poller 接线 + 删旧管道**
   - 删 `draft` 导入、`maybe_service_reply`、`_draft_and_send`、`_send_ack`、
     `confirm_plan`、`_is_plan_ok`、`suggestions`、`draft_index`、`llm_status`。
   - `poll_chat`：新消息按 kind 收集批次；本人新消息 → `mark_replied_before`；
     收尾时对 `watching` 且非 blocked 的会话 `turns.wake(batch)`。
   - `status()`：`service` → `instances`（含 turn 状态、session 元数据）；
     `doctor()`：模型检查替换为「值守会话就绪」。
   - 验证：更新后的 `tests/test_polling.py` 全过。

6. **server 路由**
   - 删 `/api/draft`、`/api/suggestion`、`/api/chat/plan-confirm`；
     加 `/api/chat/session/reset`（先打断再清绑定）；
     `/api/watch` 不再收 mode/auto_send/reply_mode；
     `/api/chats`、`/api/status` 透出实例状态。
   - 验证：`test_stdio.py` + 路由白盒用例。

7. **测试**
   - 删 `test_reply_modes.py`；新增 `test_turns.py`；更新
     `test_polling.py`（interval 下限仍是 10；config 用例改 public 形状；
     加 pending 闭环用例）；`test_stdio.py` 加 session/reset 用例。
   - 验证：`python3 -m unittest discover -s tests` 全绿。

8. **panel.js 收缩**
   - 删：起草按钮 / 草稿建议 / 回复模式 / 自动发 / 接管客服开关 / 起草模型卡 /
     全自动客服卡。
   - 加：实例状态（值守中 / 处理中 / 已屏蔽）、「新建会话」、DSH 会话轮数；
     手动发送保留；`setInterval(tick, 6000)` → `60000`。
   - 重建 `lib/client.js`（`python3 scripts/build_client.py`）。

9. **文档与闸门**
   - contracts 01/02/03、architecture 02-data（分类/待回闭环）、
     dsh-plugin README、CHANGELOG、PROGRESS、当日 log；
     0003 spec 顶部补「已放弃（被 0004 取代）」。
   - `bash scripts/gate.sh --quick` 全绿；全量 `python3 tests/run_tests.py`。

## 回滚点

- 提交拆分：①存储+配置 ②dshrun+turns ③poller+server ④UI+docs。
- chats 新列无害；退役列保留；`panel.json` 老键忽略不报错。
