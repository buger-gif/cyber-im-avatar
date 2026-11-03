# 0015 服务对象画像的上限与自动整理

> 状态: 已验收
> 编号: 0015
> 版本: 0.8.x
> 关联: `docs/specs/archive/0012-profile-file-and-message-pointers.md`
>
> 后续：DSH 插件已由 `docs/specs/active/0018-agent-owned-profile.md` 改为 agent 直接读写
> 画像；插件不再在 prompt 里强制整理、不代写、不归档。独立形态与 `--compact` 不变。

## 背景

画像文件当前只有一个 12KB 硬拒写。agent 每轮把新事实按日期追加到「历史结论」，
画像逐渐变成流水账：一份真实画像的「历史结论」已有 50+ 行，按「10:05 / 10:11 /
10:20 …」排列的查证过程占了大部分，稳定结论被淹没；接近 12KB 时，下一次回写直接
失败，也没有整理入口。用户反馈「画像一直追加，太丑陋了」。

## 目标与非目标

- 目标：画像保持「四段稳定结论」，不按轮次追加；超过软上限时自动触发整理，
  硬上限仍然兜底；整理缩小时保留旧版归档。
- 非目标：不改画像路径、四段结构、面板编辑与 mtime CAS；不在插件里额外调用模型
  做摘要；不改 `state.json` 契约。

## 方案

### 1. 两个阈值

- `SOFT_PROFILE = 8KB`：唤醒 prompt 附整理指令，并要求本轮回写整理后的完整画像。
- `MAX_PROFILE = 12KB`：保持不变，超过拒写。

### 2. prompt 常驻维护规则

- 每次唤醒都说明：「历史结论」只放仍然有效的结论，不按日期记流水；同一事实合并 /
  覆盖，旧结论被推翻就改原句；「历史结论」控制在 20 条内。
- 画像 > 8KB 时追加：本轮必须整理到 8KB 以下（至少不超过 12KB），保留四段结构，
  合并重复、删除一次性 / 已失效、把日期流水改写成结论。
- 触发不止体积：`历史结论` >20 条或日期流水 >8 条时同样要求整理，避免「没超上限但已是
  流水账」。
- 没有新事实但画像 > 8KB 时，也要附整理后的完整画像；没有新事实且未超限才不附。

### 3. 归档

- 新画像比旧画像小、且旧画像 > 8KB 时，宿主在写入成功后把旧文本追加到
  `profiles/<platform>/<file_id>.history.md`（0600），带
  `<!-- archived <ISO 时间> -->` 标记。
- 只在缩小时归档；mtime CAS 失败（用户刚改过）不归档。

### 4. 独立 skill 的兜底命令

- `bootstrap.py --compact PLATFORM ALIAS [--dry-run]`：
  - 去掉完全相同的 bullet（按小节去重）；
  - 主文件超 12KB、「历史结论」超过 20 条或日期流水超过 8 条时，从最旧（列表末尾）
    开始把 bullet 移到 history 文件，直到回到上限内；
  - 仍超 12KB 时退出 2，提示压缩其他小节；`--dry-run` 只打印不落盘。
- `--note` 追加后如果超限，自动走同一套去重 / 归档。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 只把硬上限降到 6KB | 到点仍是一次性拒写，之前的内容依旧流水账 |
| 超限直接截断 | 会静默丢事实，违反「不丢事实」 |
| 插件内再调一次模型做摘要 | 增加一次模型调用与失败面；当前 turn 的 agent 顺手整理即可 |
| 每次写入都归档 | history 迅速膨胀；只在「整理后变小」时归档 |

## 影响面

- 代码：`dsh-plugin/lib/profiles.js`、`dsh-plugin/lib/turns.js`、`scripts/bootstrap.py`
- 测试：`dsh-plugin/tests/profiles.test.mjs`、`dsh-plugin/tests/turns.test.mjs`、
  `tests/run_tests.py`
- 文档：`SKILL.md`、`README.md`、`CHANGELOG.md`
- 用户可见：画像不再无限变长；接近上限会被要求整理；旧版在 `.history.md`
- 兼容：老画像原样可读，不需要迁移

## 验收

- [x] 9KB 画像 → `buildPrompt` 含「整理」与「12KB」提示
- [x] 旧画像 9KB、新画像 5KB → 写入成功，`.history.md` 出现旧文本
- [x] 新画像 12KB+1 → 拒写，原画像不变
- [x] `--compact` 30 条历史结论的画像 → 保留 ≤20 条，其余进 history，主文件 ≤12KB
- [x] 完全重复的 bullet 被去重
- [x] `--dry-run` 不落盘
- [x] `bash scripts/gate.sh --quick` 与全量测试通过

## 风险与回滚

- 风险：整理时误删仍有效的事实；history 文件持续变大。
- 回滚：从 `.history.md` 恢复旧版；撤掉 prompt 的整理段与 `--compact` 命令即可。
