# PROGRESS — 当前断点

> **新会话第一读取点。** 这份文件只回答三个问题：现在到哪了、什么被挂起了、下一步动哪里。
> 写法见 `docs/AGENTS.md`：活文档，就地改写，不做历史（历史在 `docs/implementation/log/`）。

## 更新时间

2026-11-27（0065 刷屏不漏命中已实施并归档，自动测试全绿；真机两项挂账；未发版）

## 最近批次

| 日期 | 主题 | 证据 |
| --- | --- | --- |
| 2026-11-27 | 刷屏不漏命中（0065，已归档）：快车道从 30 次逐会话尾部采样改成 1 条账号级消息流（`+messages-search` 按值守会话收窄 + 时间窗 + `has_more`），命中进 `delivered_at` 待投集合、载荷写进会话才落标记；慢车道改为每 10 分钟区间对账补漏（`runtime.stream.missed`）；流截断追加 `@我` 兜底，流失败当轮降级；请求 34→5 次/分钟，触发仍 60 秒；新增 13 条流测试 | `dsh-plugin/lib/{im,poller,state,prompt,turns}.js`、`dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、`dsh-plugin/tests/stream.test.mjs`、契约 02、`docs/architecture/02-data.md §拉取节奏`、`docs/specs/archive/0065-刷屏不漏命中.md`、`CHANGELOG.md` |
| 2026-11-26 | 0.27.1 发布：0064 面板认 DSH 会话进版；Trusted Publishing 成功（run 45780260539，3m23s，版本自检通过）；npm latest 0.27.1；tag `v0.27.1`；市场索引指向 0.27.1 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、[run 45780260539](https://github.com/buger-gif/cyber-im-avatar/actions/runs/45780260539) |
| 2026-11-26 | 面板认 DSH 会话（0064，已归档，真机已验）：桌面壳只在启动时取一次 index 注入快照，插件热重载换 token 后已开面板 401；鉴权加 DSH 签名会话（`connection.requestRejection`），token 保留兜底；401 文案去掉 ⌘R；重载后页面未刷新，15:59:38 面板 `/api/status` 走 DSH 会话通过 | `dsh-plugin/lib/panel-auth.js`、`dsh-plugin/lib/index.js`、`dsh-plugin/web/panel.js`、`dsh-plugin/tests/panel-auth.test.mjs`、`docs/specs/archive/0064-面板认DSH会话.md` |
| 2026-11-26 | 0.27.0 发布：0062 载荷瘦身 + 0063 中断收尾保护进版；Trusted Publishing 成功（run 45765790784，2m50s，版本自检通过）；npm latest 0.27.0；tag `v0.27.0`；市场索引指向 0.27.0 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、[run 45765790784](https://github.com/buger-gif/cyber-im-avatar/actions/runs/45765790784) |
| 2026-11-26 | 中断收尾保护（0063，已归档，隔离真机已验）：思考阶段停止后只落 reasoning 的 assistant 消息，下一轮会被严格网关 400 卡死；在进程内包 `session.append`，命中时补一个 Markdown 注释形式的占位正文（模型可见、转录不显示），不改事件 / seq / 现有历史；`IM_REASONING_GUARD=0` 可关 | `dsh-plugin/lib/guard.js`、`dsh-plugin/lib/index.js`、`dsh-plugin/tests/guard.test.mjs`、`docs/specs/archive/0063-中断收尾占位.md` |
| 2026-11-25 | 载荷瘦身与防腐（0062，已归档，真机项挂账）：载荷只留事实 / 变化 / 硬门，开场口径 1904 → 706 字；`DELTAS` 口径注册表 + 三个缺口修复；快照 / 预算 / 矩阵测试与 `prompt-stats`；skill 分载到 `references/standalone.md`（532 → 339 行），`AGENTS.md` 加铁律 9 | `dsh-plugin/lib/prompt.js`、`dsh-plugin/lib/turns.js`、`dsh-plugin/tests/{prompt-snapshot,prompt-rules}.test.mjs`、`dsh-plugin/scripts/prompt-stats.mjs`、`SKILL.md`、`references/standalone.md`、`docs/specs/archive/0062-启动载荷瘦身与防腐.md` |
| 2026-11-24 | 0.26.0 发布：0056–0061 进版；Trusted Publishing 成功（run 45343717026，4m39s，版本自检通过）；npm latest 0.26.0（06:57:01Z）；tag `v0.26.0`；市场索引指向 0.26.0；npm / 自托管索引 / awesome 收录三处描述同步 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、[run 45343717026](https://github.com/buger-gif/cyber-im-avatar/actions/runs/45343717026)、[awesome PR #18426](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/18426) |
| 2026-11-24 | 进度卡等待期与群聊（0061，已归档，真机已验）：卡片按等待期而非 turn，发信即撤回、面板记 `replied`；连续指令 handoff 同一张卡；开场不建卡；飞书群聊新增默认关闭的独立开关与单群三态 | `dsh-plugin/lib/{progress,turns,im,state,app}.js`、`dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、契约 01/02/03、`docs/specs/archive/0061-进度卡等待期与群聊.md`、ADR 0020 |
| 2026-11-24 | 发言权默认沉默（0060，已归档，真机已验）：默认动作改为沉默；发言要有增量或真人明确在问；机器告警 / 催办卡的角色 @ 不算叫我干活，机器人发过 / 卡片写着 / 自己说过的不重复；日报加 `[未回]` | `dsh-plugin/lib/{profiles,turns,duty}.js`、`dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、`SKILL.md`、`docs/decisions/implemented/0019-发言权默认沉默.md` |

| 日期 | 主题 | 证据 |
| --- | --- | --- |
| 2026-11-24 | 任务完成收尾（0059，已归档，真机已验）：保活轮写 `[值守收尾]` 标记，插件记 `closing` + 2 天观察；新命中 / 待回 / 在飞取消，到期无新活才退役；7 天静默退役跳过 closing | `dsh-plugin/lib/{duty,state,poller,turns}.js`、`dsh-plugin/web/panel.js`、契约 01/02/03、`docs/specs/archive/0059-任务完成收尾.md` |
| 2026-11-24 | 分身值守筛选（0058，已归档，真机已验）：「值守中」列表加名称搜索 + 状态 chips（处理中 / 上轮失败 / 待回）+ 平台下拉 + facet 计数与「命中 N / 总 M」+ 空态复位；沿 0054 的 `filterBar`，卡片建一次只按条件挂载；纯前端、不改接口 | `dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、`docs/specs/archive/0058-分身值守筛选.md` |
| 2026-11-24 | 人员承诺边界（0056，已归档，真机已验）：只拦本人到场 / 拍板（参会、约时间、出差、签字、付款、授权、接受风险）；查证 / 复测 / 修复 / 文档 / 解释 / 催办由分身直接做，不再进 P1 | `SKILL.md`、`dsh-plugin/lib/turns.js`、`dsh-plugin/lib/duty.js`、`docs/specs/archive/0056-人员承诺边界.md` |
| 2026-11-24 | 值守自动退役（0057，已归档，真机已验）：连续 7 天无命中自动 `retired`；`duty.last_hit_at` + `duty.retire_after_days`；待回 / 在飞 / trial 不动；群新 @ 重新分诊 | `dsh-plugin/lib/{state,duty,poller}.js`、`dsh-plugin/web/panel.js`、契约 01/02/03、`docs/specs/archive/0057-值守自动退役.md` |
| 2026-11-23 | 0.25.0 发布：0052 / 0053 / 0054 进版；Trusted Publishing 成功（run 45140421056，3m30s）；npm latest 0.25.0（08:42:54Z，tarball 200）；tag `v0.25.0`；市场索引指向 0.25.0 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、[run 45140421056](https://github.com/buger-gif/cyber-im-avatar/actions/runs/45140421056) |
| 2026-11-23 | 服务对象筛选与搜索（0054，已归档，真机已验）：群聊 / 人物两段各加名称搜索 + 状态 chips + 平台下拉 + facet 计数；空态可一键复位；纯前端、不改接口 | `dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、`docs/specs/archive/0054-服务对象筛选与搜索.md`、`CHANGELOG.md` |
| 2026-11-23 | 文档收敛（0055）：16 个已实现 spec + plan 归档；active 上限 2、plan 按需、目标版本闸进 `verify_docs` | `docs/specs/README.md`、`docs/AGENTS.md §4`、`scripts/verify_docs.py`、`docs/specs/archive/README.md` |
| 2026-11-23 | 引用消息进载荷（0053，已归档，真机已验）：飞书 `reply_to` + `+messages-mget` 补原文，载荷加 `↪ 引用` 行；取不到明说；企微 / 钉钉不接 | `dsh-plugin/lib/{im,state,poller,turns}.js`、契约 01/02、`docs/specs/archive/0053-引用消息进载荷.md` |
| 2026-11-23 | 私聊进度卡（0052，已归档，真机已验）：2 分钟建 Card 2.0，按动作计数原地 patch；全局默认关 + 会话三态；`progress.ids` 不计入「本人已回复」 | `dsh-plugin/lib/progress.js`、契约 01/02/03、`docs/specs/archive/0052-私聊进度卡.md` |
| 2026-11-19 | 0.24.2 发布：交付本人文档不再当成「授权」，开权限不带重复通知；Trusted Publishing 绿，市场索引指向 0.24.2 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json` |
| 2026-11-19 | CI 去告警：`checkout` / `setup-node` / `setup-python` 统一升 v7（node24），四个 job 无弃用告警 | `.github/workflows/test.yml`、`docs/implementation/runbooks/dev-loop.md` |

## 当前断点

- **active 为空**；0065「刷屏不漏命中」已实施并归档（账号级消息流 + `delivered_at` 待投集合 +
  慢车道对账，请求 34/分钟 → 5/分钟），自动测试全绿；真机两项挂账（见下）；下一个号 0066，上限 2。
- **0.27.0 已发布**：npm latest 0.27.0（2026-11-26T06:08 前后可见），tag `v0.27.0`，
  Trusted Publishing run [45765790784](https://github.com/buger-gif/cyber-im-avatar/actions/runs/45765790784)
  成功；市场索引已指向 0.27.0。
- **中断卡死兜底已落地**：0063 在隔离的 DSH 0.2.2-rc.5 宿主 + 模拟网关实测——关闭开关时复现
  400，开启后同一会话续聊成功，聊天转录看不到占位文案。桌面 app 未重启（避免中断当前会话）。
- **各市场描述已同步**：npm 描述与 README、自托管索引（`--source npm`）、awesome-dsh-plugin
  条目描述（PR [#18426](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/18426)）
  口径一致——默认沉默、承诺边界、值守生命周期、进度卡发信即撤回。
- **市场收录**：条目 PR [#11669](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11669) 已合并；
  描述更新 PR #18426 等评审。
- **验证环境**：3080 用 `IM_STANDIN_DIR=/tmp/im-standin-accept` 隔离状态；没有向真实客户外发。

## 挂账（按优先级）

1. **0065 真机两项（中优先）**：①水群里 @ 自己后刷 300 条，120 秒内起 turn、载荷含该 @ 且只一次，
   `/api/status` 的请求计数从 30/分钟降到个位数；②停进程 10 分钟再启，恢复期间的 @ 与私聊被一次
   流读完，超过 200 条时记 `truncated_at`。另：话题群线程回复里的 @ 是否被流返回，返回不了就记进
   `references/feishu.md` 并另开 spec。
2. **0063 桌面 app 复核（低优先）**：隔离 0.2.2-rc.5 宿主已验；下次重启桌面 app 时在任意会话
   按验收再走一次「思考阶段停止 → 再发一条」，确认侧边栏值守收发不受影响。
3. **0062 真机两项**：面板「加入值守」看一次开场载荷（应 ≤30 行、口径 18 行）、一次真实命中
   仍按发送方式起草 / 发送；自动测试已覆盖快照与预算，真机等用户在场时补。
4. **0062 残留（低频）**：会话压缩后只补口径 / 运行形态 / 记忆路径 / 硬门，不重新注入
   `/cyber-im-avatar` 手势；若规则正文恰被压缩掉，最坏表现是沉默或停手（安全侧）。彻底解决
   需评估压缩后补手势的 token 成本，下次做载荷相关 spec 时一起看。
5. **真实客户 live turn / 真实平台媒体**：0013 / 0017 只做过合成验证，真实飞书 / 企微
   图片、文件、语音尚未命中；等用户在场或指定测试会话时补，不主动外发。
6. **历史待回清理**：旧库迁移带来的约 50 条 pending 是否一次清掉，待用户拍板。
7. **0.5.0 屏蔽的 UI 端到端截图**：功能已过测试，截图验证仍中断。
8. **钉钉真发与真人闭环**：轮询 / 唤醒 / 发送已支持，真实发送只到 dry-run；真发前先定
   `--ai-tag` 口径（默认给消息打 AI 标识），再找真人会话跑「命中 → 草稿 → 发送 → 重挂」。

## 下一步

1. 等 awesome-dsh-plugin 描述更新 PR #18426 合并；评审要求改就推同一分支，不重开 PR。
2. 等真实客户消息 / 媒体命中；只观察，不主动给真实客户发消息。
3. 用户确认后清理历史待回；钉钉补真人闭环；补 0.5.0 屏蔽 UI 端到端截图。
4. 下次发版前按 runbook 把 `prompt-stats` 读数抄进当日 log。

## 规则性提醒

- 改路由 / state 字段 / 配置键 → 同 commit 改 `docs/specs/contracts/`，否则测试红。
- spec 先于代码；active 至多 2 项，实现 + 自动测试绿就归档，真机项进挂账。
- 收尾跑 `bash scripts/gate.sh --quick`；发版跑全量。
- 版本号三处一致：`dsh-plugin/package.json`、`CHANGELOG.md` 顶部、git tag。
- 一个 DSH 宿主写 state；别同时开桌面 app 与 3080 值守同一批会话。
- 公开仓库不写真实消息、真实 ID、本机路径与凭据；演练只用合成夹具。
