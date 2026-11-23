# PROGRESS — 当前断点

> **新会话第一读取点。** 这份文件只回答三个问题：现在到哪了、什么被挂起了、下一步动哪里。
> 写法见 `docs/AGENTS.md`：活文档，就地改写，不做历史（历史在 `docs/implementation/log/`）。

## 更新时间

2026-11-23（0055 文档收敛：active 清空；0052 / 0053 真机项挂账；0.24.2 仍是 npm latest）

## 最近批次

| 日期 | 主题 | 证据 |
| --- | --- | --- |
| 2026-11-23 | 文档收敛（0055）：16 个已实现 spec + plan 归档；active 上限 2、plan 按需、目标版本闸进 `verify_docs` | `docs/specs/README.md`、`docs/AGENTS.md §4`、`scripts/verify_docs.py`、`docs/specs/archive/README.md` |
| 2026-11-23 | 引用消息进载荷（0053，已归档，真机待验）：飞书 `reply_to` + `+messages-mget` 补原文，载荷加 `↪ 引用` 行；取不到明说；企微 / 钉钉不接 | `dsh-plugin/lib/{im,state,poller,turns}.js`、契约 01/02、`docs/specs/archive/0053-引用消息进载荷.md` |
| 2026-11-23 | 私聊进度卡（0052，已归档，真机待验）：2 分钟建 Card 2.0，按动作计数原地 patch；全局默认关 + 会话三态；`progress.ids` 不计入「本人已回复」 | `dsh-plugin/lib/progress.js`、契约 01/02/03、`docs/specs/archive/0052-私聊进度卡.md` |
| 2026-11-19 | 0.24.2 发布：交付本人文档不再当成「授权」，开权限不带重复通知；Trusted Publishing 绿，市场索引指向 0.24.2 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json` |
| 2026-11-19 | CI 去告警：`checkout` / `setup-node` / `setup-python` 统一升 v7（node24），四个 job 无弃用告警 | `.github/workflows/test.yml`、`docs/implementation/runbooks/dev-loop.md` |

## 当前断点

- **active 已清空**：0055 归档后 `docs/specs/active/` 为空，下一个 spec 从 0056 起；
  新开之前先确认手上没有在办项（上限 2，`verify_docs.py` 会拦）。
- **0.25.0 未发布**：0052 / 0053 代码已提交、自动测试绿，spec 已归档；真机项见下面挂账 1–2。
  发版时把 `CHANGELOG.md` 的 `## 未发布` 转正、改 `dsh-plugin/package.json`、跑全量 gate、打 tag。
- **市场收录待合并**：条目 PR [#11669](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11669)。
- **验证环境**：3080 用 `IM_STANDIN_DIR=/tmp/im-standin-accept` 隔离状态；没有向真实客户外发。

## 挂账（按优先级）

1. **真机验 0052**：设置页全局开 / 关与单聊三态、2 分钟内不发、2 分钟后卡片计数增长、
   `[进度]` 的现在 / 接着、轮询不把卡误判成「本人已回复」。验完划掉。
2. **真机验 0053**：重启插件后回复一条更早的消息 → 载荷出现 `↪ 引用`；引用被删除 →
   写「原消息取不到」且轮询不报错。验完划掉。
3. **真实客户 live turn / 真实平台媒体**：0013 / 0017 只做过合成验证，真实飞书 / 企微
   图片、文件、语音尚未命中；等用户在场或指定测试会话时补，不主动外发。
4. **历史待回清理**：旧库迁移带来的约 50 条 pending 是否一次清掉，待用户拍板。
5. **0.5.0 屏蔽的 UI 端到端截图**：功能已过测试，截图验证仍中断。
6. **钉钉真发与真人闭环**：轮询 / 唤醒 / 发送已支持，真实发送只到 dry-run；真发前先定
   `--ai-tag` 口径（默认给消息打 AI 标识），再找真人会话跑「命中 → 草稿 → 发送 → 重挂」。

## 下一步

1. 提交 0054 服务对象筛选与搜索（面板搜索 / 筛选）；刷新真实面板确认，验完归档并挂账真机项。
2. 真机验 0052 / 0053（挂账 1 / 2）；验出问题按新 spec 开，不重开旧 spec。
3. 发 0.25.0：未发布小节转正 → 改版本 → 全量 gate → tag → 市场索引。
4. 等真实客户消息 / 媒体命中；只观察，不主动给真实客户发消息。
5. 用户确认后清理历史待回。
6. 钉钉补真人闭环：启用，跑「命中 → 草稿 → 发送 → 重挂」。

## 规则性提醒

- 改路由 / state 字段 / 配置键 → 同 commit 改 `docs/specs/contracts/`，否则测试红。
- spec 先于代码；active 至多 2 项，实现 + 自动测试绿就归档，真机项进挂账。
- 收尾跑 `bash scripts/gate.sh --quick`；发版跑全量。
- 版本号三处一致：`dsh-plugin/package.json`、`CHANGELOG.md` 顶部、git tag。
- 一个 DSH 宿主写 state；别同时开桌面 app 与 3080 值守同一批会话。
- 公开仓库不写真实消息、真实 ID、本机路径与凭据；演练只用合成夹具。
