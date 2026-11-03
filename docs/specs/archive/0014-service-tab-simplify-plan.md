# 0014 实施计划

> 同编号 plan。一步一验证；每步做完跑对应检查。

## 1. 后端搜索字段映射

- [x] `lib/im.js` `search()`：补 `localized_name` / `p2p_chat_id` / `department`；
      `searchChats()` 的 `name` 去掉 `chat_id` 兜底。
- [x] `tests/im.test.mjs` 用 stub `run()` 断言 `localized_name` → `name`、`p2p_chat_id` → `chat_id`。
- 验证：`node --test tests/im.test.mjs`。

## 2. 分身页签结构调整

- [x] `web/panel.js`：搜索卡片移到 `serviceView()` 顶部，合并搜人/搜群结果。
- [x] 删除群清单、已屏蔽清单、旧「找群」「加入值守」卡片与 `S.gsearch` / `S.gAll`。
- [x] 值守群卡片补「定时检测 @我」开关。
- [x] 已屏蔽恢复入口移到设置「值守范围」。
- 验证：`python3 scripts/build_client.py && node --test`。

## 3. 端到端与文档

- [x] 独立预览页 + 搜索夹具截图：只看值守、搜索合并、无 imid。
- [x] 更新 `CHANGELOG.md`（未发布）、`docs/implementation/PROGRESS.md`、当日 log。
- [x] `bash scripts/gate.sh --quick` 全绿。
