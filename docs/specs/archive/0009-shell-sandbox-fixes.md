# 0009 壳内不挂监听 + 打断续用同会话

> 状态: 实施中
> 编号: 0009
> 版本: 0.8.0
> 关联: `docs/specs/archive/0004-skill-shell.md`、`docs/specs/archive/0005-sidebar-dock.md`

## 背景

第一次真实值守暴露两个问题：

1. **壳内 agent 去挂监听**：DSH headless 会话的沙箱是 `workspace-write`（DSH 的
   per-session policy，工作区边界 = 会话 cwd），而 skill 的监听脚本要
   `chmod ~/.im-standin` 并写 `states/*.pos`，都在工作区外 → PermissionError，
   agent 报「监听没能重挂」。插件本来就是耳朵，这一轮不需要、也不应该再挂监听。
2. **打断没有续用同一个 session**：session id 原本要等 turn 结束才落库；首轮在飞时
   来了新消息，打断后库里还是空的，于是 `_spawn` 又新建了一个 session，违背
   「同一个 session 发新消息」。

## 目标与非目标

- 目标：
  - 唤醒 prompt 明确「轮询/水位/唤醒由插件负责，不要运行 listen_cli / bootstrap，
    不要重挂监听」；SKILL.md 增加 `IM_STANDIN_SHELL=1` 时的分支；
  - `dshrun.start` 给子进程注入 `IM_STANDIN_SHELL=1`；
  - 打断在飞 turn 时，先把内存里已到的 `session_id` 落库，再同 session 重起。
- 非目标：
  - 不把 DSH 沙箱改成 `danger-full-access`，不给 agent 工作区外的写权限；
  - 不把 `~/.im-standin` 搬进工作区（插件与 skill 共用同一份状态）；
  - 不改监听脚本的既有安全策略（0700、原子写）；独立 skill 形态在非沙箱终端跑。

## DSH 权限结论

DSH 的沙箱策略按**会话**解析，不继承工作区目录的权限：

- 部署默认在 profile 配置里（headless 当前为 `workspace-write`）；
- 会话的 `cwd` 是唯一的可写工作区边界，不支持追加可写根目录；
- 会话可以用 `sandbox/mode` 事件切到 `danger-full-access` 并跨重启保留，但那是
  整个文件系统的写权限，不适合为了一个状态目录常开。

因此正确做法不是扩权，而是让壳内 agent 不执行需要工作区外写入的监听步骤。

## 方案

### 1. 唤醒 prompt

在 `turns.build_prompt` 增加：

> 值守轮询 / 水位 / 唤醒由插件负责（`IM_STANDIN_SHELL=1`）：不要运行 listen_cli
> 或 bootstrap，也不要重挂监听；SKILL.md 里的「挂监听 / 重挂」步骤直接跳过。

skill 指路从「标准闭环」改为「回复风格 / 平台差异 / 铁律（跳过监听步骤）」。

### 2. skill 分支

`SKILL.md` 增加「在 DSH 插件壳里」：`IM_STANDIN_SHELL=1` 时只处理唤醒载荷，
不挂监听、不重挂；回复风格、平台差异与铁律照用。

### 3. 打断续会话

`TurnManager.wake` 打断旧 turn 后，读取 `old.session_id`（reader 线程在 `session`
事件到达时就已写入），非空则 `store.set_dsh_session`，再 `_spawn`；这样重起的
`--session-id` 就是同一个会话。旧 worker 仍被 generation 拦掉，不会回写状态。

## 影响面

- `service/turns.py`：prompt 文案；打断时落 session。
- `service/dshrun.py`：子进程环境变量 `IM_STANDIN_SHELL=1`。
- `SKILL.md`：壳内分支说明。
- `tests/test_turns.py`：prompt 断言 + 首轮未落库时打断仍续用同 session。
- README / CHANGELOG / PROGRESS / 当日 log / troubleshoot。

## 验收

- [x] 任务经 `/cyber-im-avatar` 注入 skill；壳内分支写明不挂监听，环境带 `IM_STANDIN_SHELL=1`；
- [ ] 首轮 session id 未落库时被新消息打断 → 第二次 `--session-id` 仍是同一个；
- [ ] 壳内 turn 不再尝试挂监听，`~/.im-standin` 不再出现 PermissionError；
- [ ] 独立 skill 形态不受影响（仍可挂监听，状态目录不变）；
- [ ] 测试全过 + `gate.sh --quick` 全绿。

## 风险与回滚

- agent 若无视 prompt 仍去挂监听，PermissionError 会以工具错误出现在会话里；
  SKILL.md 的壳内分支是第二道提醒，不保证模型 100% 遵守。
- 打断时若 `session` 事件还没到（极早期），仍会新建会话；属于窗口期，无法从插件侧
  凭空知道 id。
- 回滚：prompt/环境变量与打断落库均可单独 revert，无数据迁移。
