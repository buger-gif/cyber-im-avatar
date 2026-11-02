# 架构文档索引

三篇讲完「这系统为什么长这样」。它们描述**目标态**，不是变更史——变更史在
`CHANGELOG.md` 与 `docs/implementation/log/`。

| 篇目 | 回答什么问题 | 什么时候必须改 |
| --- | --- | --- |
| `docs/architecture/01-shape.md` | 两种形态怎么分工、为什么一个端口都不开、同源路由与三层校验、后端模块边界 | 改挂载方式 / 传输层 / 模块依赖方向 |
| `docs/architecture/02-data.md` | 数据落在哪、state.json 各层管什么、会话状态怎么组合、什么情况下才拉消息 | 改 state 字段 / 拉取节奏 / 分类规则 |
| `docs/architecture/03-runtime.md` | 怎么装、模型和凭据从哪来、live turn 怎么跑、出问题去哪看 | 改安装方式 / 唤醒路径 / 配置语义 |

读的顺序：先 01 建立形状，再 02 看数据怎么流，最后 03 把系统跑起来。

分工提醒：

- **确切形状**（哪个路由、哪张表、哪个配置键）不在本目录，在 `docs/specs/contracts/`，
  那里被测试逐字对账。
- **某次改动为什么这么做**不在本目录，在 `docs/specs/archive/` 与 `docs/decisions/`。
- **现在做到哪了**不在本目录，在 `docs/implementation/PROGRESS.md`。

本目录出现的数字（端口、默认值、冷却秒数）都必须是当前代码的取值；写「大约」「通常」的地方
说明那里本来就不该是硬约束。
