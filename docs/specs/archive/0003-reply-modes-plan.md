# 0003 回复模式 — 实施计划

> 一步一验证；每步收尾跑 `python -m unittest`，最后一步跑 `bash scripts/gate.sh`。

## 1. 存储：chats 表 3 新列

- `store.py`：`_migrate` 补 `reply_mode/reply_state/reply_state_at`；
  `set_chat()` 支持 `reply_mode`（白名单校验）；新增 `set_reply_state(platform, chat_id, state)`。
- 单测（tests/test_storage.py）：新库/老库补列、非法 mode 落回 direct、state 读写。

## 2. 配置：reply 段

- `config.py`：DEFAULTS 加 `reply`（ack_templates/plan_ok_words/plan_auto_ok），
  normalize 夹紧三键。
- 单测：默认值、ack_templates 传空数组回默认、plan_ok_words 去空白去重。

## 3. draft.py MODES 注册表

- 常量 `MODES = {"direct","ack","plan","clarify"}`；
  `build_prompt(..., mode="direct", phase="reply")`：任务段按上表替换，
  ack.phase=reply 的 header 加「(已先应答)」并追加「不要再说收到」。
- `CLARIFY_PREFIX = "CLARIFY:"`；新增 `split_clarify(text) -> (is_question, body)`。
- 单测：四种 mode × phase 的任务段断言、split_clarify 命中/不命中。

## 4. poller.py 状态机

- `_service_msg` 按状态机改写：ack 直发（hash 选模板、sends 留痕、失败不阻塞）、
  plan 两阶段、ok 白名单判定（`_is_plan_ok(text, words)`：strip+去标点+lower 全等）、
  失败清 state。
- 单测：fake drafter/adapter 覆盖状态机全部边（ack 发送、plan→await→人工/自动继续、
  白名单误报防护如「行吧」不命中、起草失败退 direct）。

## 5. server.py + web/panel.js

- 路由：`/api/chat/set` 收 `reply_mode`；新增 `/api/chat/plan-confirm`；
  `/api/state` 透出 `reply_mode/reply_state`。
- 面板：service 会话详情模式四选一；`awaiting_plan_ok` 行内「确认继续」按钮；
  设置页 ack 话术编辑 + plan_auto_ok 开关。
- `scripts/build_client.py` 重建 `lib/client.js`。
- 验证：`node --check lib/client.js`；起服务点一遍四模式切换。

## 6. 契约 + 文档 + gate

- 同 commit 改 `02-storage.md`（3 列）、`03-config.md`（reply 段）。
- README「全自动客服」小节补模式说明。
- `bash scripts/gate.sh` 五项 PASS；spec 验收条目逐条对勾；
  通过后 `git mv docs/specs/active/0003-reply-modes*.md docs/specs/archive/` 并登记。
