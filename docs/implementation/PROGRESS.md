# PROGRESS — 当前断点

> **新会话第一读取点。** 这份文件只回答三个问题：现在到哪了、什么被挂起了、下一步动哪里。
> 写法见 `docs/AGENTS.md`：活文档，就地改写，不做历史（历史在 `docs/implementation/log/`）。

## 更新时间

2026-11-02（v0.8.0：Node 单进程壳；公开历史已脱敏重写并 push，npm 待发布）

## 最近批次

| 日期 | 主题 | 证据 |
| --- | --- | --- |
| 2026-11-02 | 插件重写为 Node 单进程（spec 0013）：删 Python/stdio/SQLite/headless，state.json + live turn | `dsh-plugin/lib/`、`tests/*.test.mjs`、`scripts/migrate-state.mjs` |
| 2026-11-02 | 服务对象画像文件 + 消息只留指针（spec 0012） | `lib/profiles.js`、`docs/specs/archive/0012-*.md` |
| 2026-11-02 | 工作区接线修正（spec 0011）：加入值守带工作区、换区即解绑 | `lib/workspaces.js`、`tests/turns.test.mjs` |
| 2026-11-02 | 插件收缩为分身壳（spec 0004）：命中唤醒 DSH 会话、示例永久复用 | `docs/specs/archive/0004-skill-shell.md` |
| 2026-11-02 | 外观跟随 DSH 浅/深色 + 删除浮层只留右侧栏（spec 0007/0008） | `lib/client.js`、`docs/specs/archive/0007-*.md` |
| 2026-11-01 | v0.7.0 发版：bypass token 手动发布 + 索引切 npm 源 | 历史发版提交、registry latest=0.7.0 |
| 2026-11-01 | 文档体系 + 防劣化闸门（spec 0002） | `scripts/gate.sh`、`tests/test_docs.py` |

## 当前断点

- 工作区代码 = **v0.8.0（已 push；历史已压成单提交并脱敏；npm 待发布）**：插件只剩 DSH 宿主里的 Node 模块
  `lib/index.js`（同源路由/token/skill 安装/服务注入）→ `app.js`（API）→
  `poller.js` + `im.js`（拉取）→ `turns.js`（live turn）→ `state.js` / `profiles.js`
  / `workspaces.js` / `sessions.js`。没有 Python、stdio、SQLite、headless 子进程。
- 状态已迁到 `~/.im-standin/state.json`（73 会话、5 个服务对象、每会话 ≤10 条）；
  旧库改名 `panel.db.migrated`。`env.json` 只读，`panel.json` 运行期不再读。
- 3080 实测：插件 `ready`；poller 首轮拉示例对象 A；`/api/status|chats|inbox|thread|targets|
  workspaces|doctor` 正常；面板五 tab、右侧栏停靠、浅/深色、无 JS 异常
  （`/tmp/im-check-*.png`）。
- live turn 实测：用合成会话 `oc_e2e_local_only`（无效 chat_id，无真实外发）跑通
  `create → followup → turn/end → session_turns+1`，断点后同一 `dsh_session` 复用；
  测试会话与画像已 `/api/forget` 清理。**真实客户未在本轮被唤醒/发送。**
- 真实 0.8.0 live turn 仍待一次「有真实新消息」的命中验证；23:17 已给示例对象 A重置绑定
  （旧 `session-****` 清空，`watching`/工作区 `业务工作区` 保留），等下一条客户
  消息命中时由 live turn 创建新会话；示例对象 A当前 `pending=0`。inbox 有 50 条历史待回
  （旧库迁移存量，未逐条清理）。
- 测试：`node --test` 51 条全过（state/profiles/im/poller/turns/app/migration）；
  `tests/test_docs.py` 契约对账已改为 Node 探针。
- `main` 已 push（公开历史压成单提交并脱敏；旧 tag 已删，`v0.8.0` 待
  npm 凭据完成后重打）。npm 线上 latest 仍是 `dsh-cyber-im-avatar@0.7.0`：
  tag 触发的 publish 在 Trusted Publishing 步骤报 404（包设置里尚未登记
  Trusted Publisher），0.8.0 未发布；`dsh-plugin/market/index.json` 仍指 0.7.0
  是正确状态。
- 桌面 DSH 与 3080 都装的是本地 `link:` 插件；两者不能同时写同一份 state，
  开发/验证只留一个。

## 挂账（按优先级）

1. **npm 发布凭据**：0.8.0 的 publish 被 OIDC 404 挡住。二选一：
   npm 包设置登记 Trusted Publisher（`buger-gif/cyber-im-avatar` + `publish.yml`），
   或提供带 bypass-2FA 的 granular token；之后重跑 publish workflow / 本地 `npm publish`。
   2FA 目前未完成：CLI 的 TOTP 路线需要一次邮箱 OTP；网页安全密钥需要本人在场。
2. **v0.8.0 tag**：历史重写后旧 tag 已删，npm 发布前不要重打。
3. **v0.8.0 发版**：npm 未发布，索引仍指 0.7.0。
4. **历史待回清理**：迁移带来的 50 条旧 pending 是否在面板「收件箱 → 清理」一次，
   还是等用户逐个看，待拍板。
5. **0.5.0 屏蔽的 UI 端到端截图**：功能已过测试，截图验证被中断。

## 下一步

1. 等示例对象 A下一条消息命中 → live turn（新会话）→ post-turn 拉取闭环；期间不要主动给
   真实客户发消息，除非用户在草稿确认流里同意。
2. 跑 `node --test` + `bash scripts/gate.sh` 全量；`python3 tests/run_tests.py`
   确认 skill 形态未受影响。
3. 同步 `~/.agents/skills/cyber-im-avatar` 的 SKILL.md（`node scripts/bundle-skill.mjs` + 安装副本）。
4. 按需把 0011/0012/0013 归档，更新 README/CHANGELOG 后发 0.8.0。

## 规则性提醒

- 改路由 / state 字段 / 配置键 → 同 commit 改 `docs/specs/contracts/`，否则测试红。
- 收尾跑 `bash scripts/gate.sh --quick`；发版跑全量。
- 版本号三处一致：`dsh-plugin/package.json`、`CHANGELOG.md` 顶部、git tag。
- 一个 DSH 宿主写 state；别同时开桌面 app 与 3080 值守同一批会话。
