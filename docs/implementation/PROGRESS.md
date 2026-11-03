# PROGRESS — 当前断点

> **新会话第一读取点。** 这份文件只回答三个问题：现在到哪了、什么被挂起了、下一步动哪里。
> 写法见 `docs/AGENTS.md`：活文档，就地改写，不做历史（历史在 `docs/implementation/log/`）。

## 更新时间

2026-11-03（v0.8.0 已发布；分身页签收敛 + 面板配色 + 监听缓存续期 + 画像整理 + 唤醒增量，未发版）

## 最近批次

| 日期 | 主题 | 证据 |
| --- | --- | --- |
| 2026-11-03 | 唤醒载荷增量追加：首轮完整，同会话后续只发新消息（spec 0016） | `lib/turns.js`、`lib/state.js`、`lib/poller.js` |
| 2026-11-03 | 画像 8KB/12KB 上限 + 整理归档（spec 0015） | `lib/profiles.js`、`lib/turns.js`、`scripts/bootstrap.py` |
| 2026-11-03 | 监听脚本 55 分钟主动退出续上下文缓存（skill 形态） | `scripts/listen_core.py`、`README.md`、`tests/run_tests.py` |
| 2026-11-03 | 面板配色改用 DSH 语义 token（浅/深两套跟随宿主） | `web/panel.js`、`lib/client.js` |
| 2026-11-03 | 分身页签只留守值会话 + 搜人/搜群合并（spec 0014） | `web/panel.js`、`lib/im.js`、`tests/im.test.mjs` |
| 2026-11-02 | 插件重写为 Node 单进程（spec 0013）：删 Python/stdio/SQLite/headless，state.json + live turn | `dsh-plugin/lib/`、`tests/*.test.mjs`、`scripts/migrate-state.mjs` |
| 2026-11-02 | 服务对象画像文件 + 消息只留指针（spec 0012） | `lib/profiles.js`、`docs/specs/archive/0012-*.md` |
| 2026-11-02 | 工作区接线修正（spec 0011）：加入值守带工作区、换区即解绑 | `lib/workspaces.js`、`tests/turns.test.mjs` |
| 2026-11-02 | 插件收缩为分身壳（spec 0004）：命中唤醒 DSH 会话、示例永久复用 | `docs/specs/archive/0004-skill-shell.md` |
| 2026-11-02 | 外观跟随 DSH 浅/深色 + 删除浮层只留右侧栏（spec 0007/0008） | `lib/client.js`、`docs/specs/archive/0007-*.md` |
| 2026-11-01 | v0.7.0 发版：bypass token 手动发布 + 索引切 npm 源 | 历史发版提交、registry latest=0.7.0 |
| 2026-11-01 | 文档体系 + 防劣化闸门（spec 0002） | `scripts/gate.sh`、`tests/test_docs.py` |

## 当前断点

- 唤醒载荷改为增量（spec 0016）：`chats.prompt_session` 标记已消费完整载荷的 session；同会话后续只发新消息，换会话/重置回到完整载荷。
- 画像新增软上限 8KB / 硬上限 12KB（spec 0015）：超 8KB、历史结论 >20 条或日期流水
  >8 条时，prompt 要求当轮整理成结论；缩小时旧版归档到 `<画像>.history.md`；
  独立形态用 `bootstrap.py --compact` 兜底。
- 监听脚本新增 55 分钟缓存续期（未发版，仅 skill 形态）：到点退出 3，agent 重挂那次
  模型调用续上下文缓存；`--cache-refresh-min 0` 关闭。DSH 插件形态不走脚本，暂未加心跳。
- 分身页签已收敛（spec 0014，未发版）：只列 `watching && !blocked` 的会话；顶部一个
  输入框同时搜人/搜群，结果只显示名称、部门与「群/私聊」，不再出现 `open_id` / `chat_id`。
  飞书搜人的可读字段是 `localized_name`，已在 `lib/im.js` 映射；`/api/search` 新增
  `chat_id`（优先 `p2p_chat_id`）与 `department` 两个兼容字段。`lib/client.js` 已重建，
  截图走查 `/tmp/im-service-search.png`（演示假数据）。
- 面板配色已改跟 DSH 主题 token（未发版）：`--bg/--panel/--fg/--line/--accent/--danger/
  --warn/--ok` 都取 `--dsw-alias-*`，深色只换 fallback；主按钮、焦点环、消息气泡、
  toast、平台头像一并换到 DSH 调色板。独立预览页注入真实 token 后浅色解析
  `bg=#fff fg=#0f1115`、深色 `bg=#151517 panel=#232324`；窄栏截图
  `/tmp/im-narrow-light.png`、`/tmp/im-narrow-dark.png`。`lib/client.js` 已重建，
  3080 刷新后生效。
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
