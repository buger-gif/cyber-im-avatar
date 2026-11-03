# 0018 插件只追加消息，画像交给 agent 自己维护

> 状态: 已验收
> 编号: 0018
> 版本: 0.8.x
> 关联: `docs/specs/active/0015-profile-compaction.md`、`docs/specs/active/0016-wake-payload-incremental.md`、`docs/specs/contracts/02-storage.md`、`docs/specs/contracts/03-config.md`

## 背景

DSH 插件当前把画像正文拼进唤醒 prompt，再在 turn 结束后解析 agent 回复末尾的
`<!-- im-profile-update ... -->` 块，由插件做 12KB 检查、mtime CAS 和旧版归档。
这条链路有两个问题：

- **不稳定**：画像更新依赖 agent 在最终回复里附一段约定格式的 Markdown；格式偏差、
  回复被截断、turn 被新消息打断都会丢掉这次更新，且失败是静默的。
- **不够 AI-native**：agent 明明有文件工具，却要先把画像“文本中转”给插件，再由插件
  解析回写；插件承担了它不该承担的语义判断。

用户要求：DSH 模式下画像更新由 agent 自己完成；插件只做确定性的消息追加，不解析
agent 文本，也不代写画像。运行中进程被杀，下一轮继续追加新消息即可，不重建完整载荷。

## 目标与非目标

- 目标：每次唤醒的载荷只追加本次新到的消息；首轮多一行 `/cyber-im-avatar` 入口，
  之后不再重复 skill 入口、画像正文和最近 10 条。
- 目标：agent 直接读/写 `~/.im-standin/profiles/<platform>/<chat_id>.md`；插件不再
  注入画像正文，不再解析回复，不再做画像压缩、归档或 mtime CAS。
- 目标：插件只在确定性边界上工作：轮询、水位、批量消息、媒体、DSH 会话与权限。
- 非目标：不改独立 skill 形态的画像维护流程；不改面板手动编辑画像的接口；不新增
  第三方运行时依赖；不为面板另开端口。

## 方案

### 1. 唤醒载荷只追加新消息

`Turns.wake()` 不再区分「完整载荷 / 增量载荷」。每次唤醒只渲染本次要交给 agent 的
消息（poller 的 `batch`，或手动唤醒/失败重试的 `pendingMessages`），格式固定：

```
/cyber-im-avatar                         ← 仅当前 session 还没消费过唤醒载荷
值守命中 · 飞书 · 对象 · 新消息
chat_id：oc_xxx
运行形态：DSH 插件壳；监听、水位、唤醒由插件负责，不要挂监听。
画像文件：/Users/.../profiles/feishu/oc_xxx.md（起草前自己读；学到长期事实就直接改这个文件）
- [10:32] 对方: 正文
```

`chats.prompt_session` 保留，但语义收窄为「当前 DSH session 已消费过唤醒载荷」：
只用来决定是否加 `/cyber-im-avatar` 入口，不再决定发完整还是增量载荷。
换会话/重置会清空它；进程被杀后它随 `state.json` 恢复，下一轮继续追加。

`session_turns` 仍然只用于展示与统计，不参与载荷组装。

### 2. 画像由 agent 自己读写

- prompt 只给画像**路径**，不贴正文；agent 用文件工具读当前对象这一份。
- 回复发出后，agent 按 `SKILL.md §服务对象画像` 直接改画像文件：增量合并、保留四段、
  写前重读、旧版整理时自己追加到 `.history.md`。
- 插件删除 `PROFILE_RE`、`applyProfile()`、`profileNote()`、`profileNeedsCompact()`、
  `Profiles.archive()` 与 `write()` 的 mtime CAS；面板仍可读/覆盖写画像，12KB 硬上限保留。
- 不再存在 `im-profile-update` 约定；客户正文里的 `<!--` 仍会被转义，避免注入。

### 3. 画像写入权限

DSH 的 `workspace-write` 只允许写会话工作区，画像目录在工作区外。为让 agent 直接写：

- 新增配置 `dsh.full_access`（boolean，默认 `false`）。
- 为 `true` 时，`Turns` 在每轮 `followup` 前调用宿主 `permissionPresets.set(agent.session,
  "danger-full-access")`；该预设是 DSH 内置的「完整文件访问 + 不弹审批」。
- 宿主没有 `permissionPresets` 时只记一条 warning，turn 照常跑；agent 写画像失败要
  如实告诉用户，不允许退回“把画像塞进回复让插件代写”。
- 默认关闭：公开仓库的用户必须显式开启，开启后面板显示「完整文件访问」警告。

### 4. 没有待回就不产生空载荷

手动唤醒没有 pending 时，`/api/chat/wake` 与 `Turns.wake()` 都返回 `no_pending`，
不再用最近 10 条凑一个载荷。

### 5. 被杀后的恢复

- 水位与 `recent` 已落盘；进程重启后 `pendingMessages` 仍是待回消息。
- 已消费过的 prompt（`prompt_session == dsh_session`）继续只追加新消息；没消费过的
  首轮会重新带 `/cyber-im-avatar` 入口，但载荷里仍然只有新消息，不重建画像/历史。
- 不再有“完整载荷”路径，因此不需要在重启时回退到完整载荷。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 保留 `im-profile-update` 文本块，只把解析写得更宽容 | 格式解析永远有边界情况，失败还是静默；用户明确要求去掉 |
| 插件提供一个画像写工具，agent 调工具 | 沙箱不用放开，但插件仍在代写画像；用户选的是 agent 直接改 |
| 把画像放到工作区/软链/硬链接 | 个人数据会落进项目目录；DSH 原子写会替换 inode，硬链接不可靠 |
| 会话工作区改成画像目录 | 会破坏“工作区 = 调研范围”的语义，DSH 侧栏分组也会漂 |
| 默认 `danger-full-access` | 对公开仓库用户是危险默认；保持 `false`，由用户显式开启 |

## 影响面

- 代码：`dsh-plugin/lib/turns.js`、`state.js`、`profiles.js`、`app.js`、`index.js`
- 契约：`docs/specs/contracts/02-storage.md`（`prompt_session` 语义）、
  `docs/specs/contracts/03-config.md`（`dsh.full_access`）
- 用户可见：DSH 会话里只剩新消息；画像由 agent 直接改；设置页出现完整文件访问开关
- 兼容：老 `state.json` 的 `prompt_session` 原样可用；`full_access` 缺省关闭，
  老用户行为不变（画像写入会失败，需显式开启）

## 验收

- [x] 首轮 prompt 含 `/cyber-im-avatar`、画像路径、本次新消息；不含画像正文、最近 10 条、`im-profile-update`
- [x] 同一 session 第二轮 prompt 不含 `/cyber-im-avatar`，只含新消息
- [x] 换会话/重置后的第一次唤醒重新带 `/cyber-im-avatar`，载荷仍只有新消息
- [x] agent 回复里伪造 `<!-- im-profile-update ... -->`，画像文件不变
- [x] 进程重启后（`prompt_session` 已写）下一轮只追加新消息
- [x] `dsh.full_access=true` → 调用 `permissionPresets.set(session, "danger-full-access")`；
  `false` → 不调用
- [x] 手动唤醒无 pending → `no_pending`，不启动 turn
- [x] `node --test`、`python3 -I tests/run_tests.py`、`bash scripts/gate.sh --quick` 全绿

> 代码、测试与合成 live turn 已验收：2026-11-03 用合成会话 `oc_e2e_local_only`（无效 chat_id，
> 无外发）在 DSH 3080 上跑通唤醒；会话元数据含 `danger-full-access`，agent 直接写了
> `profiles/feishu/oc_e2e_local_only.md`。真实客户值守命中待命中。

## 风险与回滚

- 风险：`danger-full-access` 让 agent 能写整个 home；只能靠 prompt/skill 约束“只改当前画像”。
  公开仓库默认关闭，开启时面板明确警告。
- 风险：agent 直接改画像没有 mtime CAS，面板与 agent 同时写可能互相覆盖；skill 要求写前
  重读、增量合并，冲突时以磁盘最新内容为准。
- 回滚：把 `dsh.full_access` 设为 `false` 即回到工作区写；代码回滚到 0017 的实现。
