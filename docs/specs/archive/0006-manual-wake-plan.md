# 0006 手动唤醒 · 实施计划

> 关联: `docs/specs/archive/0006-manual-wake.md`

1. **修回填闭环**：`poll_chat` 先算本批 `self_epoch`；更早的对方消息直接
   `replied`/`ignored`，不进 batch。加单测。
2. **加手动唤醒**：`api_chat_wake` + `POST_ROUTES` + 契约；单测覆盖最新 N 条。
3. **UI**：「现在处理」按钮（详情头部，值守中/空闲/有待回时出现）；
   重建 `lib/client.js`。
4. **清理存量**：把示例对象 A更早的待回按最后一条本人发言标 `replied`，只留 16:53 一条。
5. **真实验证**：重启 3080 → 只保留示例对象 A值守 → 点「现在处理」→ 观察 turn、
   session 轮数、agent 输出；确认没有未经确认的对外发送。
6. **收尾**：测试 + gate + 截图/文档/PROGRESS/log；spec 归档。

回滚点：poller 修正单独可留；API/UI 可整段回退。
