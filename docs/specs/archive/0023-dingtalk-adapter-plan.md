# 0023 插件壳支持钉钉 · 实施计划

> 状态: 实施中
> 关联: `docs/specs/active/0023-dingtalk-adapter.md`

一步一验证；每步完成后勾掉，失败就在这一步停下修。

## 1. adapter 与字段映射

- [x] `lib/im.js` 增加 `ADAPTERS.dingtalk`：`profile list` 身份、`+chat-messages` 拉取、
  `+recent-conversations` 发现、`contact user search` / `+chat-search` 搜索、
  `+messages-send` 发送。
- [x] 泛化 `listChats` / `searchChats` 使用 `f_chat_id` / `f_chat_name` / `f_chat_mode`，
  飞书 / 企微补默认路径，行为不变。
- [x] 泛化 `search` 使用可选 `f_search_*`；钉钉把 `userId` 落成 `chat_id`，DＭ 走 `--user`。
- [x] `whoami` 支持 `require_fresh_self`：`profiles[]` 为空时判未登录，不吃缓存。
- [x] 验证：`node --test` 新增钉钉解析用例（桩输出），全绿。

## 2. 平台启用与契约

- [x] `state.js`：`SUPPORTED_PLATFORMS` 加 `dingtalk`；`DEFAULT_CONFIG.platforms` 不变。
- [x] `app.js`：`POST /api/platforms`；`/api/watch` 加入钉钉时自动启用平台。
- [x] `contracts/01-api.md`、`contracts/03-config.md` 同 commit 更新。
- [x] 验证：`python3 -I tests/test_docs.py` 的契约对账全绿。

## 3. 轮询与诊断

- [x] `poller.status()` 遍历三平台，未启用平台 `enabled=false`、跳过 `whoami`。
- [x] `poller.doctor()` 未启用平台只报 `warn`「未启用」。
- [x] `legacyPlatforms()` 只收未知平台。
- [x] 验证：隔离实例里关 / 开钉钉，`/api/status` 与 `/api/doctor` 读数符合预期。

## 4. 面板

- [x] 体检页固定三张平台卡；未启用显示「未启用 + 启用」。
- [x] 体检页不随 60 秒刷新；顶部「刷新」「跑一次体检」手动触发。
- [x] 搜索下拉按已启用平台渲染（钉钉启用后可选）。
- [x] 验证：`python3 scripts/build_client.py` 后 `lib/client.js` 与 `panel.js` 同步。

## 5. 文档与验收

- [x] `README.md`（插件只支持飞书/企微的表述）、`references/dingtalk.md` 顶部说明、
  `dsh-plugin/README.md`、`CHANGELOG.md` 的 0.9.0 小节、`SKILL.md` 如有引用一并改。
- [x] 用桩 `dws` 在隔离实例跑一轮拉取 + dry-run 发送；不碰真实账号。
- [x] `bash scripts/gate.sh` 全量全绿。
