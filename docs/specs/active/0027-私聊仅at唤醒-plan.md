# 0027 实施计划

> 一步一验证；每步都跑得动再进下一步。

## 1. 状态与迁移

- `dsh-plugin/lib/state.js`：`STATE_VERSION = 2`；`defaultState()` 用它；`normalizeChat()`
  的 `wake_mode` 默认按 kind 取（群 `mention` / 私聊 `all`）；`load()` 读 `raw.version < 2`
  时把全部 `p2p` 会话的 `wake_mode` 置 `all`，内存里完成后由下一次 `save()` 落盘。
- 验证：`node --test tests/state.test.mjs`——新增「version 1 私聊 mention → 加载后 all、
  保存后 version=2」「显式改成 mention 后重新加载仍是 mention」「新私聊默认 all、新群默认 mention」。

## 2. 判定

- `dsh-plugin/lib/im.js`：`Adapter` 加 `get canMention()`（`f_mentions || f_self_name`）。
- `dsh-plugin/lib/poller.js`：`process()` 在私聊 + `wake_mode=mention` 时用
  `isMention(m, selfId, names)` 分流：命中记 `dm`，否则记 `fyi` / `ignored`；
  加 `canMention(platform)` 给 app 用。
- 验证：`node --test tests/poller.test.mjs tests/im.test.mjs`——私聊 mention 模式下
  普通消息不唤醒且状态为 ignored，结构化 @ 与正文 `@名字` 各唤醒一次；群 mention / all 回归。

## 3. 接口

- `dsh-plugin/lib/app.js`：`chatMode()` 去掉「all 只对群生效」，改判「私聊 + mention +
  `canMention=false` → 明确拒绝」；`publicChat()` 输出 `mentionable`。
- 验证：`node --test tests/app.test.mjs`——私聊 all/mention 都能写；企微私聊 mention 拒绝；
  `/api/chats` 带 `mentionable`。

## 4. 唤醒载荷

- `dsh-plugin/lib/turns.js`：`buildWakePrompt` / `buildOpenPrompt` 接收 `kind`（默认 `group`，
  保持直接调用方的旧口径）；全量提示只对群生效；私聊 mention 带一句「只认 @」。调用处传
  `current.kind`。
- 验证：`node --test tests/turns.test.mjs`——私聊 all 不出现「非点名的群消息」；私聊 mention
  载荷含「只认 @」；群两条旧用例不变。

## 5. 面板

- `dsh-plugin/web/panel.js`：私聊详情用 `modeSelect` 替掉「值守」开关；`chatModeOf()` 按 kind
  判定不盯；`modeSelect` 对 `mentionable=false` 置灰 `mention` 选项；吐司与提示按 kind 分开；
  私聊 mention 时详情补一行口径说明。
- 验证：`python3 scripts/build_client.py`、`node --check lib/client.js`、
  `python3 tests/test_docs.py` 的构建产物新鲜度；起开发宿主拍 360 / 420 两张图核对不换行。

## 6. 文档与收尾

- 契约：`docs/specs/contracts/01-api.md`（`/api/chat/mode` 私聊、`/api/chats` 的 `mentionable`）、
  `docs/specs/contracts/02-storage.md`（`version` 2、`wake_mode` 两行语义、迁移）。
- 用户文档：`dsh-plugin/README.md` 的「值守会话来了新消息」与「已知限制」就地改写；
  `CHANGELOG.md` 加 `## 未发布` 小节；`PROGRESS.md` 断点与当日 log。
- 验证：`bash scripts/gate.sh --quick` 全绿；全量 `bash scripts/gate.sh`；spec 验收逐条对勾后
  归档（真机项留待用户在场时补）。
