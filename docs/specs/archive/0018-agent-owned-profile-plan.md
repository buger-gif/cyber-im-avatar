# 0018 实施计划：插件只追加消息，画像交给 agent

> 关联：`docs/specs/archive/0018-agent-owned-profile.md`

## 步骤

1. [x] `turns.js`：合并 `buildPrompt` / `buildDeltaPrompt` 为单一 `buildWakePrompt`；
   每轮只渲染本次消息，`prompt_session` 只决定是否带 `/cyber-im-avatar`；删除画像正文、
   最近 10 条、`im-profile-update` 与画像整理提示。
2. [x] `turns.js`：删除 `PROFILE_RE`、`applyProfile`、`profileNote`、assistant 正文收集；
   `runTurn` 只看 `turn/start` / `user/message` / `turn/end`。
3. [x] `profiles.js`：删除 `SOFT_PROFILE`、`profileNeedsCompact`、`historyPath`、`archive`
   与 `write()` 的 mtime CAS；保留 `MAX_PROFILE`、模板、面板读写。
4. [x] `state.js`：`dsh.full_access` 默认 `false`，`normalizeConfig` 归一为布尔；
   `prompt_session` 语义改为“已消费过唤醒载荷”，不再选择完整/增量。
5. [x] `app.js`：手动唤醒无 pending 返回 `no_pending`；`Turns.wake()` 同步兜底。
6. [x] `index.js`：注入 `permissionPresets`；`Turns` 在 `full_access=true` 时每轮
   `set(agent.session, "danger-full-access")`，失败只 warning。
7. [x] `web/panel.js`：设置页值守会话卡片加「完整文件访问」开关（带确认与警告），
   重建 `lib/client.js`。
8. [x] 测试： `turns.test.mjs` 重写 prompt/画像不写回/重启/权限；`profiles.test.mjs`
   删除 CAS/archive；`state.test.mjs` 补 `full_access`；`app.test.mjs` 补 `no_pending`。
9. [x] 文档：`SKILL.md`、`dsh-plugin/README.md`、`docs/architecture/01-shape.md` /
   `02-data.md` / `03-runtime.md`、契约 02/03、`CHANGELOG.md`、`PROGRESS.md`、当日 log。
10. [x] 跑 `node --test`、`python3 -I tests/run_tests.py`、`bash scripts/gate.sh --quick`；
    全量 gate 如有必要。
