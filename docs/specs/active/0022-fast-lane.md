# 0022 值守快车道：值班会话 60 秒一拉

> 状态: 实施中
> 编号: 0022
> 版本: 0.9.0
> 关联: `docs/specs/contracts/03-config.md`、`docs/architecture/02-data.md §拉取节奏`、`docs/decisions/implemented/0007-fast-lane.md`

## 背景

现在整台机器只有一个节奏：`poll.interval_min`（默认 10 分钟）跑一轮，轮里做三件事——
`whoami`、刷会话列表、拉候选。值守会话最坏 10 分钟才被发现，有人找你要等十分钟。

`docs/decisions/implemented/0002-poll-rhythm.md` 把下限定在 10 分钟，是为了不拿 IM 接口当靶子；
但那个成本模型说的是「全量会话 + 会话列表刷新」。值守名单通常只有几个会话，按 60 秒只拉这几个，
调用量是可控的，而且正是用户要的响应速度。

## 目标与非目标

- 目标：值守中的会话（私聊 + `timer=1` 的群）**60 秒内**被拉到；发现新会话、刷新列表仍按 10 分钟。
- 非目标：
  - 不引入推送/长连接/新端口（`docs/decisions/implemented/0001-zero-port.md` 不翻）。
  - 不改群默认不拉的规则：`timer=0` / `-1` 的群仍然一个都不碰。
  - 不改唤醒、turn、收件箱、日报任何逻辑。
  - 不改 `state.json` 结构。

## 方案

### 两条车道

| 车道 | 频率 | 动作 | 不做 |
| --- | --- | --- | --- |
| **快** | `poll.fast_sec`（默认 60 秒） | 只拉 `candidates()`：值守私聊 + `timer=1` 的群；`whoami` 用缓存 | 不刷会话列表、不发现新会话、不写 `runtime` |
| **慢** | `poll.interval_min`（默认 10 分钟） | `whoami`、刷会话列表、拉候选、写 `runtime` 统计 | — |

候选规则不变（`candidates()`）：平台支持、`blocked=0`、`watching=1`；私聊 `timer != -1`；
群只有 `timer=1`。

### 调度

`tick()` 每秒只做一件事：判断该走哪条车道。

```
tick 到点 → paused? 停 2 秒再看
          → now >= nextCycleAt ? 慢车道 cycle() → nextCycleAt += intervalSec
                               : 快车道 fastCycle()
          → 下一次唤醒 = min(fastSec, 距慢车道的秒数)
```

- 两条车道共用一个 `cycleLock`：慢车道在跑时快车道直接让过，不并发打接口。
- 快车道**不写** `runtime`（那是 10 分钟一次的事），统计只放内存，`/api/status.poll.last_fast` 读。
- 快车道里身份不可用就静默跳过该平台——错误由慢车道每轮记一次，不能让 60 秒刷一条错误日志。
- 仍有待回（`pendingCount > 0`）时快车道传 `force`，不受 20 秒冷却限制，和慢车道一致。

### 配置

新增 `poll.fast_sec`：

| 键 | 默认 | 取值 | 说明 |
| --- | --- | --- | --- |
| `poll.fast_sec` | `60` | `0` 或 20–600 | 值守快车道间隔；`0` = 关闭，退回只有 10 分钟慢车道 |

夹取规则：`int(v, 0, 600, 60)`；非 0 且小于 20 的一律抬到 20；超过 `interval_min * 60` 的按
`interval_min * 60` 算（快车道不该比慢车道还慢）。

### 成本可见

- `pollInfo()` 增加 `fast_sec` / `fast_at` / `last_fast`。
- 体检的「拉取节奏」一行改成：`值守 60 秒（N 个会话，约 N×1440 次/天）· 发现 10 分钟`。
- 设置页的「值守节奏」卡加一个「快车道(秒)」输入，0 = 关闭；说明文案跟着改。
- 页脚从「每 10 分钟拉一轮」改成「值守 60 秒 · 发现 10 分钟」。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 把全局 `interval_min` 改成 1 | 会话列表发现也变 1 分钟；几百个会话的账号直接把接口打穿，也违背 ADR 0002 的成本模型 |
| 每个会话一个定时器 | 几十个 setTimeout 难暂停、难在 status 里解释、暂停/恢复要遍历 |
| 用平台推送 / SSE | 三个平台都没有「以本人身份收全部会话」的推送通道（ADR 0002 已记） |
| 快车道同时也刷会话列表 | 刷新是最贵的一步；新会话晚 10 分钟被发现可以接受 |
| 快车道只拉最近有消息的会话 | 判断「最近」本身就要先拉一次；不如按值守名单固定 |

## 影响面

- 代码：
  - `dsh-plugin/lib/poller.js`：`fastSec`、`tick()` 分叉、`fastCycle()`、`pollInfo()`、`doctor()` 文案。
  - `dsh-plugin/lib/state.js`：`DEFAULT_CONFIG.poll.fast_sec` 与夹取。
  - `dsh-plugin/web/panel.js`：设置页字段、页脚、体检卡片文案；重建 `lib/client.js`。
- 契约（同 commit）：`docs/specs/contracts/03-config.md` 加键与范围；
  `tests/test_docs.py` 的 `RANGE_KEYS` 加 `poll.fast_sec`。
  `02-storage.md` / `01-api.md` 不动。
- 决策：新增 `docs/decisions/implemented/0007-fast-lane.md`；
  `0002` 在索引里标注「快车道由 0007 修订」。
- 文档：`AGENTS.md` 铁律 2 改写；`docs/architecture/02-data.md §拉取节奏` 加一行；
  `CHANGELOG.md` 未发布补一节；PROGRESS 与当日 log。
- 兼容：老配置没有 `fast_sec` → 默认 60，升级后自动变快；想保持旧行为设 `0`。

## 验收

- [x] `node --test` 新增用例：快车道只调 `fetchMessages`、不调 `listChats`；`timer=-1` 私聊与
      `timer != 1` 的群不在快车道；`fast_sec=0` 时只有慢车道；暂停时两条都不跑。
- [x] 手动把 `fast_sec` 改成 5，`/api/status.poll.fast_sec` 读到 20（抬到下限）；改成 9999 读到
      `interval_min*60`；改成 0 读到 0。
- [ ] 3080 上观察两分钟：`poll.last_fast.at` 每 60 秒左右更新，`poll.last_result.at` 仍是 10 分钟。
- [ ] 体检「拉取节奏」显示「值守 60 秒（N 个会话…）· 发现 10 分钟」。
- [ ] 设置页能改快车道秒数，保存后 `/api/status` 立即生效。
- [x] `python3 tests/test_docs.py` 契约 03 全绿；`bash scripts/gate.sh --quick` 全绿。

## 风险与回滚

- 风险 1：候选多时调用量线性上涨（每个候选 1440 次/天）。缓解：体检页把候选数与估算调用量写出来；
  候选人多了用户自己会把 `fast_sec` 调大或关掉。
- 风险 2：60 秒一次拉取在没有新消息时也各花一次 CLI 调用和一次 `state.json` 写入？
  `pollChat` 只在有变化时 `save()`，无变化不写盘；调用量是用户要的延迟换成本。
- 风险 3：与慢车道在边界上撞车。缓解：共用 `cycleLock`，慢车道先到先跑。
- 回滚：`fast_sec=0` 即回到旧节奏；代码回退不需要迁移（没有 `state.json` 字段、没有新路由）。
