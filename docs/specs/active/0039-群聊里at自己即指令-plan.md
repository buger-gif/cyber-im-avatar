# 0039 实施计划

> 关联: `docs/specs/active/0039-群聊里at自己即指令.md`
> 原则：每步都有可跑的验证，先动分类再动批次，最后才写文档。

## 1. 分类：群里的自 @ 也判 `cmd`

- [x] `poller.process()` 的 `isCmdMsg` 去掉 `chat.kind !== "group"`；注释改成「本人 @ 自己」。
- [x] `dsh-plugin/tests/poller.test.mjs`：把「群里自己 @ 自己仍为 out、不唤醒」改成期望
      `cmd/new` 且唤醒一次；保留「本人不 @ 的消息是 out」的回归。
- 验证：`node --test tests/poller.test.mjs`。

## 2. 批次与合并窗口

- [x] `collectBatch()` 全量分支的 `pendings` 加 `cmd`。
- [x] `maybeWake()` 合并窗口只在批次不含 `cmd` 时生效；唤醒成功后照旧推进
      `last_wake_at` / `last_wake_epoch`。
- [x] 测试：群 all 模式自 @ 立刻唤醒；窗口内的旁观消息仍按窗口等待。
- [x] 测试：同批「对面 @ + 本人自 @」两条都进批次，对面的保持 `new`。
- 验证：`node --test tests/poller.test.mjs`。

## 3. 载荷措辞

- [x] `turns.js` 的 `cmdNote` 在 `kind === "group"` 时追加「默认不在群里发言」；
      注释去掉「私聊」限定。
- [x] `profiles.js` 注释同步。
- [x] 测试：群聊载荷含「本人（@自己）」与群聊限定；私聊载荷不出现群聊那句。
- 验证：`node --test tests/turns.test.mjs`。

## 4. 契约、决策与文档

- [x] `docs/specs/contracts/02-storage.md`：`kind` 说明去掉「私聊」限定。
- [x] `docs/architecture/02-data.md`：分类表 `out` / `cmd` 两行。
- [x] `docs/decisions/implemented/0011-群聊自at也算指令.md` + 决策索引一行。
- [x] `dsh-plugin/README.md`：交互说明改成「私聊或群里 @ 自己」。
- [x] `CHANGELOG.md` 未发布小节；`PROGRESS.md` 断点与批次行；当日 log 追加一段。
- 验证：`bash scripts/gate.sh --quick`（docs / contracts 两步都覆盖）。

## 5. 收口

- [x] `cd dsh-plugin && node --test`。
- [x] `bash scripts/gate.sh --quick`。
- [ ] 真机（用户自验）：重启宿主 → 在在盯的群 @ 自己 → 面板「处理中」，群里无自动发言。
