# 0002 实施计划

**目标**：文档有唯一入口与唯一归属；后续改动先 spec 后代码；能机器拦住的劣化不靠自觉。

**路线**：先把规则与目录立起来（段 1-2），再把契约写成可对账的形状（段 3），
最后把闸门接到「提交一次就跑一次」的位置（段 4-5）。每步都能单独验证，不留半成品。

---

### 步骤 1：目录与规则

- [x] 建 `docs/{architecture,specs/{contracts,active,archive},decisions/{proposed,implemented,rejected},implementation/{log,runbooks},audits}`
- [x] 写 `docs/AGENTS.md`：三条底层判断 + 信息之屋 + 三类生命周期 + spec 流程 + 引用约定 + 更新时机
- [x] 写 `docs/README.md`：一张图 + 路由表 + 三条捷径

验证：`grep -c "^| " docs/README.md` 有路由表；目录都在。

### 步骤 2：架构三篇

- [x] `01-shape.md`：两种形态 / skill 闭环 / 三轮驱动 / 零端口的由来 / 管道协议 / 四道校验 / 模块分工
- [x] `02-data.md`：落盘位置 / 三张表 / 会话状态 / 三条拉取路径与成本模型 / 分类 / 聚合 / 迁移
- [x] `03-runtime.md`：装 / 模型三级来源 / engine 三档 / 配置三件易误解的事 / 日志入口 / 升级纪律

验证：每篇都能回答「新会话最想问的三个问题」，且不含变更史。

### 步骤 3：三份冻结契约（可被解析）

- [x] `01-api.md`：GET 路由表（与 `ROUTES` 集合相等）+ POST 覆盖表（与 `POST_ROUTES` 相等）+ 约定
- [x] `02-storage.md`：chars/messages/sends 三张表的列 + 索引 + 迁移规矩
- [x] `03-config.md`：22 个叶子键的默认值（JSON 字面量）+ 夹取范围 + 老键迁移表 + 红线

验证：表格行能解析出 `方法|路径`、`列名`、`dotted.key|json 默认值`。

### 步骤 4：spec 与 decision

- [x] `docs/specs/README.md`（编号 + 流转 + 下一个号）+ `_template.md`
- [x] `docs/specs/archive/0001-mute.md`（回溯）
- [x] `docs/decisions/README.md` + `_template.md` + 三份 implemented：
      零端口 / 拉取节奏 / 收件箱聚合

验证：编号连续、模板可复制即用。

### 步骤 5：实施侧入口

- [x] `docs/implementation/PROGRESS.md`（断点 + 最近批次 + 挂账）
- [x] `docs/implementation/log/2026-11-01.md`（当日事实）
- [x] `runbooks/{README,dev-loop,publish,troubleshoot}.md`；`PUBLISHING.md` 迁入 `publish.md`
- [x] 根 `AGENTS.md`：项目铁律 + 动手前后读什么 + 停问条件

验证：`PROGRESS.md` 读完能说出「下一步动哪里」。

### 步骤 6：文档闸门

- [x] `scripts/verify_docs.py`：链接与锚点、活文档预算覆盖、反追加残留、spec 编号、
      archive 登记、契约表格可解析
- [x] `scripts/doc_budgets.json`：每份活文档的行数上限

验证：`python3 scripts/verify_docs.py` 退出 0；故意写坏一处能报出来。

### 步骤 7：对账测试

- [x] `tests/test_docs.py`：路由集合、表列集合、配置键与默认值、夹取范围、
      版本一致、构建产物新鲜度、契约文件可解析

验证：`python3 tests/run_tests.py` 把它一起跑了。

### 步骤 8：gate 与钩子

- [x] `scripts/gate.sh`：`--quick` 静态层（语法 / JS / 文档 / 契约 / 版本 / 产物 / 密钥），
      全量加两套测试
- [x] `.githooks/pre-commit`：跑 `--quick`，非 0 拦提交
- [x] `scripts/install-hooks.sh` + `CONTRIBUTING.md` 一行说明

验证：`bash scripts/gate.sh --quick` < 15 秒；`git commit` 时自动跑。

### 步骤 9：CI 与入口文档

- [x] `.github/workflows/test.yml`：矩阵跑根测试 + 插件测试；单跑文档闸门
- [x] `README.md` / `SKILL.md` 文件结构、`CONTRIBUTING.md` 贡献流程指向 `docs/`

验证：CI 配置无语法错；入口文档里的相对路径都存在。

### 步骤 10：收尾

- [x] `bash scripts/gate.sh` 全绿
- [x] spec 0002 验收逐条打勾，`git mv` 进 archive，登记 `archive/README.md`
- [x] 提交（一个 commit，只含文档与基础设施）
