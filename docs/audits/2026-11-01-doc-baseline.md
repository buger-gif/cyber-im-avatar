# 文档基线审计与防劣化落地（2026-11-01）

> spec 0002 的验收产物。范围：全仓 39 份 Markdown + 测试 / CI 覆盖面对账。
> 只陈述发现与处置，不写过程叙事（过程在当日 log）。

## 结论速览

文档侧共发现 7 组问题，当日全部处置完毕。核心判断：**文档与代码的漂移此前完全靠人肉，
唯一的行为防线（76 条测试）拦不住「改了接口没改文档」这一类退化**——这也是本次把
三份契约做成「测试可解析 + 与代码逐条对账」的原因。

| # | 发现 | 面 | 处置 |
| --- | --- | --- | --- |
| 1 | `references/troubleshooting.md` 的 `#a` 式字母锚点 24 处（含 `SKILL.md` 引用）不是 GitHub 可解析的锚 | 排障动线 | 全部换成真实标题锚；`tests/run_tests.py` 的锚点检查改为「HTML id 或标题锚二选一」，并把覆盖面扩到 `docs/**` |
| 2 | 发版手册 `dsh-plugin/PUBLISHING.md` 独立在包目录里，与 skill 侧文档互不引用，npm 包 files 又不带它 | 文档归属 | `git mv` 到 `docs/implementation/runbooks/publish.md`（历史可 `--follow`），`dsh-plugin/README.md` 改链 |
| 3 | 路由 / 表 / 配置的「确切形状」只存在于代码与散落的 README 表格里 | 漂移面 | 新增三份冻结契约 `docs/specs/contracts/`，`tests/test_docs.py` 与 `ROUTES` / `PRAGMA table_info` / `DEFAULTS` 逐条对账（28 路由 + 40 列 + 22 配置键） |
| 4 | `lib/client.js` 是手跑构建的产物，忘了重建没有任何检查会红 | 构建卫生 | 对账测试重算 `template.replace(...)` 与产物逐字比对 |
| 5 | 版本号三处（`package.json` / `CHANGELOG` / tag）无一致性检查，tag 与包版本错位会直接让 CI 发布失败 | 发版 | 对账测试比对前两处；tag 一致性由 `publish.yml` 既有闸覆盖 |
| 6 | CI（`test.yml`）只跑 skill 侧测试，插件 36 条与文档闸门不在 CI 里 | 覆盖面 | `test.yml` 增 `docs-gate` job；插件测试已由 `run_tests.py::test_plugin_polling` 带进矩阵 |
| 7 | 活文档无界增长无闸（本次新增 `docs/` 19 份活文档，最大风险恰恰是新体系自己） | 体系自維 | `scripts/doc_budgets.json` 行数预算 + `verify_docs.py` 强制覆盖检查 + 反流水账闸（禁「追加」标题 /「此前：」链） |

## 防劣化基础设施清单（本次落地）

| 闸门 | 拦什么 | 在哪跑 |
| --- | --- | --- |
| 契约对账（22 条） | 改路由 / 表 / 配置键不同步契约 | `tests/test_docs.py`，quick + 全量 + CI |
| 构建产物新鲜度 | 改 `panel.js` 忘了重建 | 同上 |
| 版本一致 | 包版本与 CHANGELOG 错位 | 同上 |
| verify_docs | 死链死锚 / 预算 / 反流水账 / spec 编号与登记 / 决策格式 | 同上 |
| 密钥扫描 | token 形状进仓库 | `scripts/scan-secrets.sh` |
| gate.sh | 上述全部一次跑完（quick 2 秒 / 全量约 1 分钟） | 手动 + pre-commit + CI |
| pre-commit | 提交前拦（`scripts/install-hooks.sh` 启用） | 本地 |

## 遗留

- 契约对账只覆盖「形状」（存在性 / 集合 / 默认值），不覆盖语义——某个路由返回体字段变了不会红。
  这类靠 spec 的验收清单兜，暂不上 schema 级对账（YAGNI，见 spec 0002 取舍）。
- `references/*.md` 未纳入预算体系（平台事实，随 CLI 漂移重写；已由 `test_docs` 的锚点与
  泄漏检查覆盖最低限度）。
