# cyber-im-avatar 文档导航

> 本文件是**唯一的路由入口**：想查什么，在下表找到一行，直接点进去。
> 规矩（写在哪、什么时候必须改、怎么写）见 `docs/AGENTS.md`，本文件只负责指路。

## 一张图

```
AGENTS.md                       ← agent 入口：项目铁律 + 动手前后该读什么
README.md / SKILL.md            ← 用户门面（能装什么、怎么用）
dsh-plugin/README.md            ← DSH 插件说明书（npm 包同款）
CHANGELOG.md                    ← 每个版本改了什么
docs/
├── AGENTS.md                   ← 文档体系规则（信息之屋 / spec 流程 / 写作纪律）
├── README.md                   ← 本文件：路由表
├── architecture/               ← 系统为什么长这样（三篇，650 行内讲完）
├── specs/
│   ├── contracts/              ← 冻结契约：接口 / 表 / 配置的确切形状（测试对账）
│   ├── active/                 ← 在办 spec
│   └── archive/                ← 已验收 spec + 登记表
├── decisions/                  ← 拍板记录：选了 A，为什么不是 B
├── implementation/
│   ├── PROGRESS.md             ← 当前断点（新会话第一读取点）
│   ├── runbooks/               ← 装 / 发版 / 开发环 / 排障
│   └── log/                    ← 每日事实（冻结，只追加）
└── audits/                     ← 专项检查报告（一次性）
```

## 路由表

| 场景 | 读哪 |
| --- | --- |
| 新会话进来，先搞清楚状况 | `docs/implementation/PROGRESS.md`（断点）→ 在办 spec → 当日 log |
| 系统怎么跑起来的、为什么不监听端口 | `docs/architecture/01-shape.md` |
| 数据存哪、会话有哪些状态、什么时候才拉消息 | `docs/architecture/02-data.md` |
| 装到 DSH、模型怎么走、配置项什么意思 | `docs/architecture/03-runtime.md` |
| 某个接口收什么、回什么；某张表有哪些列；某个配置键的默认值与范围 | `docs/specs/contracts/`（改这三处必须同步，否则测试红） |
| 要做一个新功能，先写什么 | `docs/specs/_template.md`，编号规则在 `docs/specs/README.md` |
| 某个功能当初为什么这么做 | `docs/specs/archive/` + `docs/decisions/` |
| 本地改代码怎么生效、怎么重启 DSH、怎么截图验证 | `docs/implementation/runbooks/dev-loop.md` |
| 怎么发 npm / 打 tag / 更新自托管索引 | `docs/implementation/runbooks/publish.md` |
| 面板白屏、后端不起、拉不到消息 | `docs/implementation/runbooks/troubleshoot.md` |
| 飞书 / 企微 / 钉钉 CLI 的字段、时间窗、授权坑 | `references/{feishu,wecom,dingtalk,troubleshooting}.md` |
| 这一版改了什么 | `CHANGELOG.md` |
| 想跑一遍全部检查（含文档与契约） | `bash scripts/gate.sh --quick`（秒级）/ `bash scripts/gate.sh`（全量） |

## 找东西的三条捷径

```bash
grep -rn "关键词" docs/                 # 文档里搜
git log --oneline -- docs/              # 文档的改动史
ls docs/specs/archive/                  # 已实现功能的编号目录
```

## 引用约定

- 文档互引一律用仓库相对全路径（`docs/architecture/02-data.md`），不用 `../`。
- 段落引用写 `§标题`，不写行号。
- `docs/implementation/log/` 与 `docs/specs/archive/` 是冻结区：引用可以，改写不行。
