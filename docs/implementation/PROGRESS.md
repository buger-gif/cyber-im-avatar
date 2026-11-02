# PROGRESS — 当前断点

> **新会话第一读取点。** 这份文件只回答三个问题：现在到哪了、什么被挂起了、下一步动哪里。
> 写法见 `docs/AGENTS.md`：活文档，就地改写，不做历史（历史在 `docs/implementation/log/`）。

## 更新时间

2026-11-03（v0.8.0：Node 单进程壳；公开历史已脱敏重写；npm 已发布，tag 已推）

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

- 工作区代码 = **v0.8.0（已 push + npm 发布 + tag 已推；历史已压成单提交并脱敏）**：插件只剩 DSH 宿主里的 Node 模块
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
- `main` 已 push，公开历史是一根脱敏提交；`v0.8.0` 指向 npm 发布后的收尾提交。
  npm 线上 latest 已是 `dsh-cyber-im-avatar@0.8.0`（发布后约 3 分钟可查），
  `dsh-plugin/market/index.json` 已切到 0.8.0（npm 源）。
- 发布凭据是 npm 网页生成的 bypass-2FA granular token（7 天有效），只放在仓库外的
  本地 0600 文件里，不写入仓库；下一版发版前应改为 Trusted Publisher。
- 桌面 DSH 与 3080 都装的是本地 `link:` 插件；两者不能同时写同一份 state，
  开发/验证只留一个。

## 挂账（按优先级）

1. **下一版发布方式**：本次用 7 天有效的 bypass-2FA granular token 发布；npm 已宣布
   2027-01 起移除直接发布。下一版发版前在 npm 包设置登记 Trusted Publisher
   （`buger-gif/cyber-im-avatar` + `publish.yml`），走 OIDC。
2. **真实 0.8.0 live turn 验收**：等示例对象 A下一条消息命中，确认新会话绑定、
   turn/end、post-turn 拉取与收件箱收敛。
3. **历史待回清理**：迁移带来的 50 条旧 pending 是否在面板「收件箱 → 清理」一次，
   还是等用户逐个看，待拍板。
4. **0.5.0 屏蔽的 UI 端到端截图**：功能已过测试，截图验证被中断。

## 下一步

1. 等示例对象 A下一条消息命中 → live turn（新会话）→ post-turn 拉取闭环；期间不要主动给
   真实客户发消息，除非用户在草稿确认流里同意。
2. 下一版发版前登记 Trusted Publisher；本次 token 到期后不要再依赖它。
3. 按需把 0011/0012/0013 归档；改文档时保持 `CHANGELOG.md`、README 与 market 索引一致。

## 规则性提醒

- 改路由 / state 字段 / 配置键 → 同 commit 改 `docs/specs/contracts/`，否则测试红。
- 收尾跑 `bash scripts/gate.sh --quick`；发版跑全量。
- 版本号三处一致：`dsh-plugin/package.json`、`CHANGELOG.md` 顶部、git tag。
- 一个 DSH 宿主写 state；别同时开桌面 app 与 3080 值守同一批会话。
