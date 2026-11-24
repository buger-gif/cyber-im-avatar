# PROGRESS — 当前断点

> **新会话第一读取点。** 这份文件只回答三个问题：现在到哪了、什么被挂起了、下一步动哪里。
> 写法见 `docs/AGENTS.md`：活文档，就地改写，不做历史（历史在 `docs/implementation/log/`）。

## 更新时间

2026-11-24（未发版：0056 人员承诺边界 / 0057 值守自动退役 / 0058 分身值守筛选 / 0059 任务完成收尾 / 0060 发言权默认沉默；0.25.0 仍是 npm latest；八项真机验收挂账）

## 最近批次

| 日期 | 主题 | 证据 |
| --- | --- | --- |
| 2026-11-24 | 发言权默认沉默（0060，已归档，真机待验）：默认动作改为沉默；发言要有增量或真人明确在问；机器告警 / 催办卡的角色 @ 不算叫我干活，机器人发过 / 卡片写着 / 自己说过的不重复；日报加 `[未回]` | `dsh-plugin/lib/{profiles,turns,duty}.js`、`dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、`SKILL.md`、`docs/decisions/implemented/0019-发言权默认沉默.md` |

| 日期 | 主题 | 证据 |
| --- | --- | --- |
| 2026-11-24 | 任务完成收尾（0059，已归档，真机待验）：保活轮写 `[值守收尾]` 标记，插件记 `closing` + 2 天观察；新命中 / 待回 / 在飞取消，到期无新活才退役；7 天静默退役跳过 closing | `dsh-plugin/lib/{duty,state,poller,turns}.js`、`dsh-plugin/web/panel.js`、契约 01/02/03、`docs/specs/archive/0059-任务完成收尾.md` |
| 2026-11-24 | 分身值守筛选（0058，已归档，真机待验）：「值守中」列表加名称搜索 + 状态 chips（处理中 / 上轮失败 / 待回）+ 平台下拉 + facet 计数与「命中 N / 总 M」+ 空态复位；沿 0054 的 `filterBar`，卡片建一次只按条件挂载；纯前端、不改接口 | `dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、`docs/specs/archive/0058-分身值守筛选.md` |
| 2026-11-24 | 人员承诺边界（0056，已归档，真机待验）：只拦本人到场 / 拍板（参会、约时间、出差、签字、付款、授权、接受风险）；查证 / 复测 / 修复 / 文档 / 解释 / 催办由分身直接做，不再进 P1 | `SKILL.md`、`dsh-plugin/lib/turns.js`、`dsh-plugin/lib/duty.js`、`docs/specs/archive/0056-人员承诺边界.md` |
| 2026-11-24 | 值守自动退役（0057，已归档，真机待验）：连续 7 天无命中自动 `retired`；`duty.last_hit_at` + `duty.retire_after_days`；待回 / 在飞 / trial 不动；群新 @ 重新分诊 | `dsh-plugin/lib/{state,duty,poller}.js`、`dsh-plugin/web/panel.js`、契约 01/02/03、`docs/specs/archive/0057-值守自动退役.md` |
| 2026-11-23 | 0.25.0 发布：0052 / 0053 / 0054 进版；Trusted Publishing 成功（run 45140421056，3m30s）；npm latest 0.25.0（08:42:54Z，tarball 200）；tag `v0.25.0`；市场索引指向 0.25.0 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、[run 45140421056](https://github.com/buger-gif/cyber-im-avatar/actions/runs/45140421056) |
| 2026-11-23 | 服务对象筛选与搜索（0054，已归档，真机待验）：群聊 / 人物两段各加名称搜索 + 状态 chips + 平台下拉 + facet 计数；空态可一键复位；纯前端、不改接口 | `dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、`docs/specs/archive/0054-服务对象筛选与搜索.md`、`CHANGELOG.md` |
| 2026-11-23 | 文档收敛（0055）：16 个已实现 spec + plan 归档；active 上限 2、plan 按需、目标版本闸进 `verify_docs` | `docs/specs/README.md`、`docs/AGENTS.md §4`、`scripts/verify_docs.py`、`docs/specs/archive/README.md` |
| 2026-11-23 | 引用消息进载荷（0053，已归档，真机待验）：飞书 `reply_to` + `+messages-mget` 补原文，载荷加 `↪ 引用` 行；取不到明说；企微 / 钉钉不接 | `dsh-plugin/lib/{im,state,poller,turns}.js`、契约 01/02、`docs/specs/archive/0053-引用消息进载荷.md` |
| 2026-11-23 | 私聊进度卡（0052，已归档，真机待验）：2 分钟建 Card 2.0，按动作计数原地 patch；全局默认关 + 会话三态；`progress.ids` 不计入「本人已回复」 | `dsh-plugin/lib/progress.js`、契约 01/02/03、`docs/specs/archive/0052-私聊进度卡.md` |
| 2026-11-19 | 0.24.2 发布：交付本人文档不再当成「授权」，开权限不带重复通知；Trusted Publishing 绿，市场索引指向 0.24.2 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json` |
| 2026-11-19 | CI 去告警：`checkout` / `setup-node` / `setup-python` 统一升 v7（node24），四个 job 无弃用告警 | `.github/workflows/test.yml`、`docs/implementation/runbooks/dev-loop.md` |

## 当前断点

- **active 已清空**：0056 / 0057 / 0058 / 0059 / 0060 实现并归档，下一个 spec 从 0061 起；上限 2。
- **0056–0060 未发版**：代码与文档已进树，`dsh-plugin/package.json` 仍是 0.25.0；
  发版按 `CHANGELOG.md` 的「未发布」小节抬到 0.26.0 后再走全量 gate。
- **0.25.0 已发布**：npm latest 0.25.0（发布 2026-11-23T08:42:54Z，tag `v0.25.0`，市场索引
  已指向）；原三项真机验收见挂账 1–3，验出问题按新 spec 开，不重开旧 spec。
- **0057 / 0059 本地读数**：真实 state 里 26 个值守（18 群 / 8 私聊），按新时钟有 6 个群
  超过 7 天无命中；插件未重启，尚未实际退役。0059 的收尾观察也要等新版本 / 重启后才会产生。
- **市场收录待合并**：条目 PR [#11669](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11669)。
- **验证环境**：3080 用 `IM_STANDIN_DIR=/tmp/im-standin-accept` 隔离状态；没有向真实客户外发。

## 挂账（按优先级）

1. **真机验 0052**：设置页全局开 / 关与单聊三态、2 分钟内不发、2 分钟后卡片计数增长、
   `[进度]` 的现在 / 接着、轮询不把卡误判成「本人已回复」。验完划掉。
2. **真机验 0053**：重启插件后回复一条更早的消息 → 载荷出现 `↪ 引用`；引用被删除 →
   写「原消息取不到」且轮询不报错。验完划掉。
3. **真机验 0054**：刷新用户本机面板（34 群 / 41 人），两段搜索、值守中 / 未写、有私聊、
   平台下拉与窄栏显示正常；验完划掉。
4. **真实客户 live turn / 真实平台媒体**：0013 / 0017 只做过合成验证，真实飞书 / 企微
   图片、文件、语音尚未命中；等用户在场或指定测试会话时补，不主动外发。
5. **历史待回清理**：旧库迁移带来的约 50 条 pending 是否一次清掉，待用户拍板。
6. **0.5.0 屏蔽的 UI 端到端截图**：功能已过测试，截图验证仍中断。
7. **钉钉真发与真人闭环**：轮询 / 唤醒 / 发送已支持，真实发送只到 dry-run；真发前先定
   `--ai-tag` 口径（默认给消息打 AI 标识），再找真人会话跑「命中 → 草稿 → 发送 → 重挂」。
8. **真机验 0057**：重启开发宿主后看设置页 7 / 0、首次 tick 退役 6 个超期群、待回 / 在飞 /
   trial 不动；再让一个退役群来新 @，确认重新分诊而不是直接恢复；私聊手动重新加入。验完划掉。
9. **真机验 0056**：在 3080 隔离状态用合成会话发「明天 11 点开个会」，全自动与草稿各跑一次，
   确认没有「可以 / 11 点行 / 准时到」，日报出现 P1，工作本不写「已答应」。验完划掉。
10. **真机验 0058**：刷新用户本机面板（26 个值守），搜名称、「处理中 / 上轮失败 / 待回」
    逐个切、平台下拉收窄、筛空点「清空搜索与筛选」复位；窄栏与深色下控件不挤。验完划掉。
11. **真机验 0059**：让一个已完成任务的群 / 私聊跑一轮保活，确认出现 `[值守收尾]` 标记与
    「任务已完成 · 观察中」；2 天内发一条新消息自动取消；不发则到期退役。验完划掉。
12. **真机验 0060**：重启 DSH 后让一个 bot 自动群（如漏洞修复跟进群）来一张催办卡，确认首轮
    载荷带「默认沉默 / 机器 @ 不算叫我干活」，分身不再补卡片已有的截止与复测口径；同时确认
    真人 @ 问进展仍会回。验完划掉。

## 下一步

1. 真机验 0059（挂账 11）；验出问题按新 spec 开。
2. 真机验 0057 / 0056（挂账 8 / 9）。
3. 刷新真实面板确认 0054 / 0058 的搜索 / 筛选（挂账 3 / 10）；验完划掉。
4. 真机验 0052 / 0053（挂账 1 / 2）。
5. 等真实客户消息 / 媒体命中；只观察，不主动给真实客户发消息。
6. 用户确认后清理历史待回；钉钉补真人闭环。

## 规则性提醒

- 改路由 / state 字段 / 配置键 → 同 commit 改 `docs/specs/contracts/`，否则测试红。
- spec 先于代码；active 至多 2 项，实现 + 自动测试绿就归档，真机项进挂账。
- 收尾跑 `bash scripts/gate.sh --quick`；发版跑全量。
- 版本号三处一致：`dsh-plugin/package.json`、`CHANGELOG.md` 顶部、git tag。
- 一个 DSH 宿主写 state；别同时开桌面 app 与 3080 值守同一批会话。
- 公开仓库不写真实消息、真实 ID、本机路径与凭据；演练只用合成夹具。
