# 文档体系规则

> 这份文件管「文档怎么写、写在哪、什么时候必须改」。文档内容本身不在这里。
> 读完这份再读 `docs/README.md` 的路由表，就知道该动哪个文件。

## 1. 三条底层判断

1. **文档是写给下一个会话的自己**，不是写给读者的宣传稿。判断标准：三天后只看这份文档，
   能不能不改代码就回答「为什么这样、现在到哪了、下一步动哪里」。
2. **一处一家**。同一个事实只允许有一个权威位置，其它地方要么引用，要么不写。
   发现两处都在描述同一件事，删掉较弱的那份，改成引用。
3. **代码是事实，文档是解释**。文档与代码冲突时以代码为准，并且必须在同一次改动里把文档改对。
   `docs/specs/contracts/` 是唯一例外——那里是**契约**，代码偏离契约就是 bug，由测试拦住。

## 2. 信息之屋

| 想知道什么 | 唯一之家 | 谁负责更新 |
| --- | --- | --- |
| 系统为什么长这样、组件怎么交互 | `docs/architecture/` | 改架构的人 |
| 接口 / 表 / 配置的**确切形状** | `docs/specs/contracts/` | 改路由、表结构、配置键的人 |
| 要做什么、边界在哪、怎么算做完 | `docs/specs/active/` | 提需求的人先写，再动手 |
| 为什么选 A 不选 B | `docs/decisions/` | 拍板的人当场写 |
| 现在断点在哪、下一步是什么 | `docs/implementation/PROGRESS.md` | 每次收尾 |
| 今天实际发生了什么（含失败与读数） | `docs/implementation/log/YYYY-MM-DD.md` | 每次收尾 |
| 某件具体的事怎么干（装 / 发版 / 排障 / 开发环） | `docs/implementation/runbooks/` | 干这件事的人 |
| 一次专项检查发现了什么 | `docs/audits/` | 做检查的人 |
| 用户怎么装、怎么用 | `README.md`、`SKILL.md`、`dsh-plugin/README.md` | 改用户可见行为的人 |
| 每个版本改了什么 | `CHANGELOG.md` | 发版的人 |

`references/` 不属于这套体系：它是**平台事实**（飞书 / 企微 / 钉钉的 CLI 行为与坑位），
随平台漂移而改，被 `SKILL.md` 与 `scripts/doctor.py` 直接引用。

## 3. 三类生命周期，写法完全不同

| 类型 | 位置 | 写法 | 能不能删 |
| --- | --- | --- | --- |
| **活文档** | architecture / contracts / implementation 除 log / decisions / 各 README | **就地改写**成当前事实。禁止「## 追加」小节、禁止「此前：… 现在：…」状态链 | 过时内容直接删 |
| **冻结区** | `docs/implementation/log/`、`docs/specs/archive/`、`docs/decisions/{implemented,rejected}/` | 只追加，不回改。写清日期与当时的事实 | 不删 |
| **一次性** | `docs/audits/` | 一份检查一份文件，结论与证据留着 | 不删 |

活文档的两个机械闸（`scripts/verify_docs.py` 强制）：

- **必须登记行数预算**：新增活文档要在 `scripts/doc_budgets.json` 里写上限。没预算 = 无界增长入口。
- **禁追加式残留**：标题里带「追加」、正文出现「此前：/原先：」一律判违规——那是在拿日期当结构。

## 4. spec 流程（后续所有功能改动都走这条）

1. **先写 spec**，落在 `docs/specs/active/NNNN-短名.md`，用 `docs/specs/_template.md`。
   编号取 `docs/specs/README.md` 里的「下一个号」，写完把指针 +1。
2. **非平凡改动配 plan**：同一编号 `NNNN-短名-plan.md`，按「一步一验证」拆成可勾选的步骤。
   小改动（单文件、无新接口）只写 spec，不写 plan。
3. **实施中改主意** → 先改 spec 再改代码。spec 与代码不一致时，spec 里写明「已放弃」并说明原因，
   不留两套方案。
4. **验收通过** → 把 spec 里「验收」逐条对勾，`git mv` 到 `docs/specs/archive/`，
   在 `docs/specs/archive/README.md` 登记一行（编号 / 标题 / 版本 / 一句话结论）。
5. **拍过板的选择**（有被否掉的备选方案）单独落一份 `docs/decisions/`，格式见该目录 README。

什么算「非平凡」：新增或改变接口、表结构、配置键、状态机、用户可见交互，或跨两个以上文件。
改错别字、调样式数值、改注释不算。

## 5. 引用约定

- 文档间互引一律写**仓库相对全路径**（`docs/specs/contracts/02-storage.md`），不写 `../` 相对路径——
  子目录搬家后不会断。`scripts/verify_docs.py` 校验所有链接与锚点。
- 引用段落用 `§标题`（如 `docs/AGENTS.md §4`），不写行号。
- 时效性指针（「当前真源」「目前断点」）只允许出现在 `docs/implementation/PROGRESS.md`，
  别的文档写成规则，不写某一天的快照。
- 外部链接不做可用性校验，但要在文末写出处。

## 6. 更新时机（收尾自检表）

| 发生了什么 | 必须动 |
| --- | --- |
| 改了路由 / 表 / 配置键 | `docs/specs/contracts/` 对应文件（否则 `tests/test_docs.py` 红） |
| 发版 | `CHANGELOG.md` + `docs/implementation/PROGRESS.md` + 当日 log |
| 架构级取舍变了 | `docs/architecture/` + `docs/decisions/` |
| 修了一个会复发的坑 | `docs/implementation/runbooks/` 或 `references/troubleshooting.md` |
| 干了半天以上的活 | 当日 `docs/implementation/log/YYYY-MM-DD.md`（事实、读数、失败尝试） |
| 新增活文档 | `scripts/doc_budgets.json` 登记预算 |

收尾只跑一条命令：`bash scripts/gate.sh --quick`（秒级），发版前跑全量 `bash scripts/gate.sh`。
