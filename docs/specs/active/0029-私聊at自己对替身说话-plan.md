# 0029 实施计划

> 一步一验证。

## 1. 分类与批次

- `lib/state.js`：`RECENT_KINDS` 加 `cmd`。
- `lib/poller.js`：`process()` 识别私聊自 @ 为 `cmd/new`、排除进 `selfEpoch`；
  `collectBatch()` 非 all 分支收 `cmd`。
- 验证：`node --test tests/poller.test.mjs`——mention / all 模式各唤醒一次，
  不带 @ 的自消息不唤醒，群里自 @ 不唤醒。

## 2. 载荷

- `lib/turns.js`：`formatMsgLine` 标记「本人（@自己）」；`buildWakePrompt` / `buildOpenPrompt`
  在含 cmd 时加规则说明。
- 验证：`node --test tests/turns.test.mjs`——cmd 行与规则出现、群口径不出现。

## 3. 熔断

- `lib/poller.js`：内存计数 + 窗口，超限写 `last_error` 并不唤醒。
- 验证：`node --test tests/poller.test.mjs`——6 条 cmd 只唤醒 5 次，第 6 次 `last_error`。

## 4. 面板与文档

- `web/panel.js`：`KIND.cmd`、`msgText` 兜底；`python3 scripts/build_client.py`。
- 契约 02 的 `kind` 枚举；`docs/architecture/02-data.md` 分类表；`dsh-plugin/README.md`
  补「@ 自己 = 和替身说话」一段；CHANGELOG / PROGRESS / 当日 log。
- 验证：`bash scripts/gate.sh`；spec 验收逐条对勾后归档。
