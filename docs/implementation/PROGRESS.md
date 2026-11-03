# PROGRESS — 当前断点

> **新会话第一读取点。** 这份文件只回答三个问题：现在到哪了、什么被挂起了、下一步动哪里。
> 写法见 `docs/AGENTS.md`：活文档，就地改写，不做历史（历史在 `docs/implementation/log/`）。

## 更新时间

2026-11-03（v0.8.0 已发布；值守可靠性、画像归 agent、每日关注摘要、重开会话入口、值守快车道，均未发版）

## 最近批次

| 日期 | 主题 | 证据 |
| --- | --- | --- |
| 2026-11-03 | 每日关注摘要：插件只读 `GET /api/digest`，面板「关注」页签，日报归 agent（spec 0019） | `lib/app.js`、`web/panel.js`、`SKILL.md`、`docs/architecture/02-data.md` |
| 2026-11-03 | 值守快车道：候选 60 秒、发现 10 分钟；`poll.fast_sec` 可关（spec 0022 / ADR 0007） | `lib/poller.js`、`lib/state.js`、`web/panel.js`、`tests/poller.test.mjs` |
| 2026-11-03 | 设计铁律 8「插件只做确定性搬运」+ 重开会话入口（spec 0020） | `AGENTS.md`、`web/panel.js`、`lib/client.js` |
| 2026-11-03 | SKILL.md 去重：只留运行时协议，排障/字段漂移指回 references | `SKILL.md`、`scripts/doc_budgets.json`、`docs/audits/2026-11-03-skill-md.md` |
| 2026-11-03 | 插件只追加消息，画像由 agent 自己读写；`dsh.full_access`（spec 0018） | `lib/turns.js`、`lib/state.js`、`lib/profiles.js`、`lib/index.js`、`tests/turns.test.mjs` |
| 2026-11-03 | 值守可靠性：last_msg_id、whoami 暂停、@ 判定、富媒体交付（spec 0017） | `lib/poller.js`、`lib/im.js`、`lib/turns.js`、`lib/media.js`、`tests/*.test.mjs` |
| 2026-11-03 | 监听脚本 55 分钟主动退出续上下文缓存（skill 形态） | `scripts/listen_core.py`、`README.md`、`tests/run_tests.py` |
| 2026-11-03 | 面板配色改用 DSH 语义 token（浅/深两套跟随宿主） | `web/panel.js`、`lib/client.js` |
| 2026-11-03 | 分身页签只留守值会话 + 搜人/搜群合并（spec 0014） | `web/panel.js`、`lib/im.js`、`tests/im.test.mjs` |
| 2026-11-02 | 插件重写为 Node 单进程（spec 0013）：删 Python/stdio/SQLite/headless，state.json + live turn | `dsh-plugin/lib/`、`tests/*.test.mjs`、`scripts/migrate-state.mjs` |
| 2026-11-02 | 服务对象画像文件 + 消息只留指针（spec 0012） | `lib/profiles.js`、`docs/specs/archive/0012-*.md` |
| 2026-11-02 | 工作区接线修正（spec 0011）：加入值守带工作区、换区即解绑 | `lib/workspaces.js`、`tests/turns.test.mjs` |
| 2026-11-02 | 插件收缩为分身壳（spec 0004）：命中唤醒 DSH 会话、示例永久复用 | `docs/specs/archive/0004-skill-shell.md` |
| 2026-11-02 | 外观跟随 DSH 浅/深色 + 删除浮层只留右侧栏（spec 0007/0008） | `lib/client.js`、`docs/specs/archive/0007-*.md` |

## 当前断点

- 每日关注摘要（0019）与重开会话入口（0020），均未发版：插件只有 `GET /api/digest` 一次
  只读（日期校验、不建目录、不解析），摘要归 agent 按 `SKILL.md §值守日报` 写
  `~/.im-standin/digest/`，面板「关注」页签显示原文；按钮改「重开会话」并移到 DSH 会话行。
  视觉与真实写盘演练待人工验（沙箱起不了临时 DSH：`~/.dsh/profiles` EPERM）。
- 未发版改动已按 turns / poller / panel / docs 四个主题提交，工作区干净、未 push；
  下一步是发版评审（0.9.0、Trusted Publisher、market 索引），见 `docs/implementation/runbooks/publish.md`。
- 值守快车道（spec 0022 / ADR 0007，未发版）：快车道每 `fast_sec`（默认 60 秒）只拉候选，
  不刷会话列表、不写 runtime；慢车道仍 10 分钟做发现。`fast_sec=0` 可关；体检页给候选数与
  调用量估算。`node --test` 101 条全过。
- 值守可靠性（spec 0017，未发版）：`chats.last_msg_id` 与 epoch 双水位（同秒不漏）、
  `whoami` 失败暂停该平台、有 mentions 只认 ID、聊天正文过 `sanitizeUntrusted()`；
  命中唤醒时下载本批媒体，图片经 DSH `attachments.admitPromptContent()` 成 image block，
  文件/音视频给本地路径，未适配/失败才提示 CLI；媒体落 `~/.im-standin/media/`，
  4 张图/10MB/单条 20 秒上限，7 天/200MB 清理。点开只读、手动 poll 受冷却、
  插件壳只留飞书/企微；`node --test` 97 条全过。真实客户媒体命中仍待验。
- 插件只追加消息（spec 0018）：每次唤醒只发本次新消息；首轮多一行 `/cyber-im-avatar`，
  之后不再重复入口。画像正文不再进 prompt，插件不解析 `im-profile-update`、不代写、
  不压缩、不归档；agent 按载荷里的画像路径自己读写。`dsh.full_access`（默认 false）开启后
  插件把值守会话切到 `danger-full-access`。进程被杀后 `prompt_session`/`recent` 落盘，
  下一轮继续追加 pending/新消息，不重建完整载荷。
- 监听脚本 55 分钟主动退出续缓存（仅 skill 形态，未发版）：退出码 3，重挂续上下文；DSH 形态未加心跳。
- 分身页签收敛（spec 0014）：只列 `watching && !blocked`；搜人/搜群一个框；飞书搜人用 `localized_name`。
- 面板配色已改跟 DSH 主题 token（未发版）：浅/深只换 fallback，`lib/client.js` 已重建。
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
- 测试：`node --test` 97 条全过（state/profiles/im/poller/turns/app/migration）；
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

1. 等示例对象 A下一条消息命中 → live turn（新会话）→ post-turn 拉取闭环；确认 agent
   直接改画像、会话权限已是 `danger-full-access`。期间不要主动给真实客户发消息，
   除非用户在草稿确认流里同意。
2. 下一版发版前登记 Trusted Publisher；本次 token 到期后不要再依赖它。
3. 按需把 0011/0012/0013 归档；改文档时保持 `CHANGELOG.md`、README 与 market 索引一致。

## 规则性提醒

- 改路由 / state 字段 / 配置键 → 同 commit 改 `docs/specs/contracts/`，否则测试红。
- 收尾跑 `bash scripts/gate.sh --quick`；发版跑全量。
- 版本号三处一致：`dsh-plugin/package.json`、`CHANGELOG.md` 顶部、git tag。
- 一个 DSH 宿主写 state；别同时开桌面 app 与 3080 值守同一批会话。
