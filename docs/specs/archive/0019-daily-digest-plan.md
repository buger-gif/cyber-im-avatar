# 0019 每日关注摘要 · 实施计划

> 状态: 待实施
> 编号: 0019
> 版本: 0.9.0
> 关联: `docs/specs/archive/0019-daily-digest.md`、`AGENTS.md §设计铁律` 第 8 条

一步一验证，每步跑完再做下一步。命令在 `dsh-plugin/` 下执行，标注「根目录」的除外。

## 步骤 0 · 基线

- 记下当前读数：`node --test` 条数、`python3 ../tests/test_docs.py` 结果、`bash ../scripts/gate.sh --quick`。
- 确认 `~/.im-standin/state.json` 的 `config.dsh.full_access` 为 `true`（日报写入依赖它）。

**验证**：三条命令全绿；`full_access` 读数记进当日 log。

## 步骤 1 · 铁律 8

已完成：`AGENTS.md §设计铁律` 第 8 条（插件只做确定性搬运）。

**验证（根目录）**：`python3 scripts/verify_docs.py` 通过；
`wc -l AGENTS.md` ≤ `scripts/doc_budgets.json` 里登记的 110。

## 步骤 2 · 只读接口

- `lib/app.js`：`GET /api/digest`，`date` 默认今天；严格 `^\d{4}-\d{2}-\d{2}$`；
  `path.resolve` 后必须仍在 `digest/` 目录内；只读，不创建目录、不写文件。
- 同 commit 改 `docs/specs/contracts/01-api.md`：加这一条 GET 路由。

**验证**：
`python3 ../tests/test_docs.py` 的「契约 01」通过 →
在 3080 上打 `/api/digest`、`?date=2026-11-02`、`?date=../../etc/passwd` 三种情况，
第三种必须 `bad_date`；目录不存在时返回 `exists:false` 且 `ls ~/.im-standin/` 前后一致（没被创建）。

## 步骤 3 · 面板

- `web/panel.js`：`S.tab` 增加 `"attention"`，页签「关注」排在收件箱后；顶部日期选择 + 「最后更新」；
  正文等宽 `text`（不解析 markdown）；空态文案；`mtime` 超 24 小时加黄色提示；不显示角标。
- 重建：`python3 scripts/build_client.py`。

**验证**：
`python3 ../tests/test_docs.py`（构建产物新鲜度）→ 3080 面板截图：有文件 / 空态 / 陈旧提示三张；
浅/深色都看一遍。

## 步骤 4 · SKILL.md 值守日报协议（核心）

把 spec 的「整理规则」「一次更新的完整动作」「模板」压成 `SKILL.md` 的一节，要求可执行：

- 触发：每次处理完一轮（回复/搁置之后、重挂之前）。
- 顺序：读最近一份 → 按会话合并 → 覆盖写今天这份；目录不存在就建（0700）。
- 硬规则：一个会话一行；覆盖写不 append；问题消失行就消失；事由 ≤40 字不抄原文；
  只记自己亲历的失败（CLI 报错/发送失败/身份失效），不猜 turn 超时。
- 复核上限：每轮最多 3 条最老的 P1/P2 用 CLI 复核。
- 边界：不写 `state.json` / `env.json` / `media/`；`full_access` 关着写不进去就如实说。

同时 `docs/architecture/02-data.md` 落盘目录加 `digest/`（一句话，指向本 spec 的整理规则），
`scripts/doc_budgets.json` 按实际行数给 `SKILL.md` 与 `02-data.md` 调预算。

**验证（根目录）**：`python3 scripts/verify_docs.py` 全绿（含预算与链接）。

## 步骤 5 · 演练（这一步不通过不算做完）

在一台真实运行中的 3080 上，让 agent 连续更新同一份日报：

1. 构造两条待回（或用手头真实待回），让 agent 写第一版。
2. 让 agent 回复其中一条，再写第二版。
3. 检查：已回的那条移出待办区、另一条仍在且 `首次` 未变、没有出现重复行、同一会话只有一行。
4. 把文件改名成昨天，再让 agent 写一版：未结项被带过来，`首次` 仍是昨天日期。
5. 删掉文件，面板刷新显示空态。

**验证**：上面 5 条逐条截图或贴文本进当日 log。

## 步骤 6 · 收尾

- `CHANGELOG.md` 的「未发布」补一小节（面板多一个「关注」页签、本地每日摘要）。
- `docs/implementation/PROGRESS.md` 更新断点；当日 `docs/implementation/log/YYYY-MM-DD.md` 记读数。
- 全量 `bash scripts/gate.sh`。

**验证**：
gate 全绿 → spec「验收」逐条对勾 → `git mv` spec 与 plan 进 `docs/specs/archive/`，
在 `archive/README.md` 登记。
