# 0016 实施计划

> 一步一验证；每步完成后勾掉再进下一步。

1. [x] `state.js`：`normalizeChat` 补 `prompt_session` 默认值；`setSession()` 换会话清空。
2. [x] `turns.js`：抽出消息行格式化；新增 `buildDeltaPrompt()`；`_wake` 按
   `prompt_session` 选完整 / 增量载荷；`wake()` 接 batch。
3. [x] `runTurn()`：prompt 被消费 / turn 成功时写 `prompt_session`。
4. [x] `poller.js`：`maybeWake()` 把 batch 传给 wake。
5. [x] Node 测试：增量载荷内容、首轮完整、换会话回到完整、未消费不算已引导。
6. [x] 契约 02 追加 `prompt_session`；跑 `node --test`。
7. [x] 文档：`dsh-plugin/README.md`、`SKILL.md`、`docs/architecture/03-runtime.md`、
   `CHANGELOG.md`、`PROGRESS.md`、当日 log；`gate.sh --quick` 全绿。
