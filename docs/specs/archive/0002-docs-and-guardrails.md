# 0002 文档体系与防劣化基础设施

> 状态: 已验收
> 编号: 0002
> 版本: 0.6.0
> 关联: `docs/AGENTS.md`、`docs/README.md`、`docs/specs/contracts/`

## 背景

代码侧一直在收敛（零端口、拉取节奏、收件箱聚合、屏蔽），文档侧是散的：

- 12 份 Markdown 平铺在仓库各处，`README` / `SKILL` / `dsh-plugin/README` / `CHANGELOG`
  各讲一段，没有「想查什么去哪」的入口；
- 设计理由只存在于提交信息与对话里，三个月后没人知道「为什么不开端口」；
- 唯一的质量防线是 76 条测试，全在行为面：改个字段名、漏改一处文档、忘了重建
  `lib/client.js`、版本号写成两个值——这四类都不会让测试红。

用户诉求原话：「整理一下项目文档 后续都走 spec 做好代码防劣化的一些基础设施
具体的文档标准、目录格式，可以参考本地同类项目的做法」。

## 目标与非目标

- 目标：① 文档有唯一入口与唯一归属；② 后续改动先 spec 后代码；③ 能机器拦住的劣化不要靠自觉。
- 非目标：不为了「像参考项目」而堆目录——参考项目有 20 多个 worker 与两机部署，
  这里只有插件 + skill，目录必须按实际信息量裁剪，空目录不建。

## 方案

### 段 1：文档目录（照参考项目的「信息之屋」，按体量裁剪）

```
docs/
├── AGENTS.md         规则：写在哪、什么时候改、怎么写（活文档/冻结区/一次性）
├── README.md         路由表：场景 → 读哪
├── architecture/     01 形态与传输 / 02 数据与会话状态 / 03 运行时
├── specs/            contracts（冻结形状）+ active（在办）+ archive（已验收）
├── decisions/        implemented / proposed / rejected + 模板
├── implementation/   PROGRESS.md（断点）+ runbooks（怎么干）+ log（每日事实）
└── audits/           专项检查报告
```

裁剪掉的：`docs/specs/contracts/` 只留三份（API / 存储 / 配置），不按业务域拆；
不建 `capability/`、`deploy/`、`prompt-injection-map` 这类只有大项目才需要的层。

### 段 2：spec 流程

编号四位递增，`docs/specs/README.md` 维护「下一个号」；非平凡改动配 `-plan.md`；
验收后 `git mv` 进 archive 并登记。0001 是回溯补写的屏蔽功能，作为格式样例。

### 段 3：机器闸门（这是「防劣化」的主体）

| 闸门 | 拦什么 | 实现 |
| --- | --- | --- |
| 契约对账 | 加了路由 / 改了列 / 加了配置键但没改契约 | `tests/test_docs.py` 解析 contracts 表格，与 `ROUTES`、`PRAGMA table_info`、`DEFAULTS` 比对 |
| 取值夹取对账 | 文档写的范围与 `normalize()` 实际夹取不一致 | 极端值喂进 `normalize()`，比对文档上下限 |
| 构建产物新鲜度 | 改了 `web/panel.js` 忘了重建 `lib/client.js` | 重跑 `scripts/build_client.py` 到临时目录比对内容 |
| 版本一致 | `package.json` / `CHANGELOG` / tag 三处不一致 | 解析两处版本号比对 |
| 文档死链死锚 | 引用已删文件、锚点打错 | `scripts/verify_docs.py` |
| 文档预算 | 活文档无限膨胀 | `scripts/doc_budgets.json` 行数上限 + 覆盖检查 |
| 反流水账 | 用「## 追加」「此前：」当结构 | `scripts/verify_docs.py` |
| 密钥扫描 | 把 token / key 提交进去 | `scripts/gate.sh` 正则扫 tracked 文件 |
| 静态不变量 | 又把 `HTTPServer`、端口、`0.0.0.0` 加回来 | `dsh-plugin/tests/test_stdio.py` 既有守卫 + 新增 |
| 一次跑完 | 上面这些没人记得跑 | `scripts/gate.sh`（全量）/ `--quick`（静态层秒级）+ pre-commit + CI |

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 引入 ruff / eslint / pre-commit 框架 | 项目承诺零第三方运行时依赖，dev 依赖也会让「clone 下来就能跑」变复杂；用标准库写 gate 够用 |
| 文档用 Sphinx / VitePress 生成站点 | 读者是下一个 AI 会话，`grep` 比导航站好用；生成产物本身还要维护 |
| 只靠 CI，不做本地闸 | 提交后再红，回滚成本比提交前拦高一个数量级 |
| 契约用 JSON Schema 自动生成 | 生成器一改，所有人得跟着改；手写表格 + 对账测试的误差面更小 |

## 影响面

- 新增：`docs/**`、`AGENTS.md`、`scripts/{verify_docs.py,gate.sh,doc_budgets.json}`、
  `.githooks/pre-commit`、`tests/test_docs.py`
- 迁移：`dsh-plugin/PUBLISHING.md` → `docs/implementation/runbooks/publish.md`
- 修改：`README.md` / `CONTRIBUTING.md` / `SKILL.md` 的文件结构与文档指针
- CI：`test.yml` 增加插件测试与文档闸门

## 验收

- [x] `bash scripts/gate.sh --quick` 全绿，且单次耗时 < 15 秒
- [x] 故意删掉契约里一行路由 → `tests/test_docs.py` 红
- [x] 故意改 `web/panel.js` 不重建 → gate 报「构建产物过期」
- [x] 故意把 `package.json` 版本改错 → gate 报版本不一致
- [x] 故意写一个不存在的链接 → `verify_docs.py` 报死链
- [x] 故意给活文档加「## 追加」小节 → `verify_docs.py` 报反流水账
- [x] `bash scripts/gate.sh`（全量）全绿：插件 36 条 + 根 76 条 + 文档闸门
- [x] 新会话按 `docs/README.md` 能在 3 跳内找到「为什么不开端口」

## 风险与回滚

- 风险：闸门太多会让人绕开（`--no-verify`）。所以 quick 层必须秒级、报错必须说清怎么改。
- 回滚：删 `docs/` 与 `scripts/gate.sh` 即恢复原状；提交是独立的一次，代码零改动。
