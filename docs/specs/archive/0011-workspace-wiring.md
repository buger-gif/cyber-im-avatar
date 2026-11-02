# 0011 工作区接线：创建即绑定、换区即解绑

> 状态: 实施中
> 编号: 0011
> 版本: 0.8.0
> 关联: `docs/specs/contracts/01-api.md`、`docs/specs/contracts/02-storage.md`

## 背景

2026-11-02 18:47，示例对象 B（飞书单聊，chat_id `oc_****`）命中值守：

- 18:47:28 第一轮 turn 的 `cwd` 是 `<默认工作区>`
  （会话 `session-****`）；
- 14 秒后 `cwd` 才变成用户想要的 `~/Desktop/业务工作区`
  （会话 `session-****`）；
- 两条 turn 都被打断；`workspace.json` 里两条会话都没有挂进任何工作区
  （`attach_session` 没发出去），DB 里 `chats.dsh_session` 最后为空。

代码审计确认这不是 DSH 的随机行为，而是五处接线缺口叠加：

1. **空工作区静默落默认**：`chats.workspace=""` 时 `dshrun._pick_cwd("")` 选 DSH
   默认工作区，但面板显示「未绑定工作区」；用户以为没绑，实际已经在默认工作区里跑。
2. **快捷加入不传工作区**：收件箱详情「值守」开关、群卡片「加入值守」、找群结果
   「加入值守」都不带 `workspace`；只有「分身 → 加入值守」的人名搜索卡片会传，
   而且默认值是 DSH 默认工作区，不是用户上次选的那个。
3. **改工作区不动现场**：`/api/chat/workspace` 只改列。已绑定会话在旧工作区时不
   解绑、在飞 turn 不打断；旧 turn 结束后仍可能把旧工作区的 session 写回。
4. **打断路径漏挂**：`wake` 打断旧 turn 时把 `session_id` 落库，却不发
   `attach_session`；新 turn 结束时因为 id 没变也不发，会话永远不进侧边栏。
5. **契约与实现错位**：契约 01 写 `/api/chat/workspace` 收 `path`，实现只读
   `workspace`；按契约调用会静默解绑。另外空工作区时 `session_in_workspace()`
   直接返回真，旧 session 可能带着错 cwd 去续聊，被 DSH 拒跑后才自愈。

同一现场还暴露：详情页的工作区选择器只在「已值守」后出现，用户没有机会在
打开值守前选好工作区。

## 目标与非目标

- 目标：
  - 面板里任何一条「加入值守」都带工作区；默认取用户上次使用的工作区
    （来自现有会话记录 / 本地面板记忆），没有才用 DSH 默认；
  - 工作区在详情页**常显**，未值守时也能先选；加入值守与「现在处理」「新建会话」
    都在同一次请求里带上当前选择，避免请求竞态；
  - 改工作区是原子的：有效 cwd 变了就打断在飞 turn；已绑会话不在新工作区时立即
    解绑并告知 UI；会话本来就在新工作区时保留；
  - 每一条新知道的 session 都申报 `attach_session`，包括打断路径和 id 未变的续聊；
  - 显式绑定的工作区不存在时，turn 以 `workspace_missing` 失败并提示，不再静默
    换到默认工作区跑；
  - 契约 01 与实现对齐：`/api/chat/workspace` 同时接受 `workspace`（UI）与
    `path`（旧契约）。

- 非目标：
  - 不搬动 DSH 会话文件、不做跨工作区迁移；旧会话留在原工作区侧边栏；
  - 不改 DSH、不开端口、不加运行时依赖；
  - 不解决两个宿主（桌面 app + 3080）同时轮询的重复唤醒（继续按「只留一个」使用）；
  - 不自动发送消息，不改 skill 的回复闭环。

## 方案

### 1. 有效工作区只在一处解析

`workspaces.resolve_for_chat(chat)` 统一返回：

```json
{
  "path": "~/Desktop/业务工作区",
  "title": "业务工作区",
  "id": "…",
  "in_dsh": true,
  "exists": true,
  "source": "chat | default | none",
  "fallback": false
}
```

- `chat.workspace` 非空：只认这个路径；目录不存在时 `exists=false`，**不回退**。
- `chat.workspace` 为空：回退 DSH 默认工作区，`source="default"`、`fallback=true`。
- 连默认都没有：`source="none"`，`path=""`。

`turns._spawn` 先解析一次有效路径，再传给 `dshrun.start`；显式工作区
`exists=false` 时直接失败（`last_reason=workspace_missing: …`），不启动 turn。
`dshrun.start` 里 `workspace=""` 不再视作「随便哪个 session 都能续」：
`session_in_workspace()` 对空路径返回假。

### 2. 改工作区原子化

`service/server.py` 新增内部函数 `_apply_workspace(platform, chat_id, raw)`：

1. `raw` 非空且规范化失败 → `{"ok": false, "reason": "工作区不存在或不是绝对路径：…"}`；
2. 比较改前 / 改后的**有效路径**；
3. 有效路径变了：
   - `POLLER.turns.interrupt()` 打断在飞 turn；
   - 已绑 session 不在新路径下 → `set_dsh_session("")`，发 `session` 事件
     （`workspace_changed=true`、带 `previous`）；
   - 已绑 session 本来就在新路径下 → 保留；
4. 写入 `chats.workspace`，返回 `{ok, workspace, effective, title}`。

`/api/chat/workspace`、`/api/watch`（带 `workspace` 时）、`/api/chat/wake`
（可选 `workspace`）、`/api/chat/session/reset`（可选 `workspace`）全部走它。
`/api/watch` 的 `workspace=""` 表示「不改变绑定」，要解绑走 `/api/chat/workspace`。

### 3. 会话申报补漏

`TurnManager` 增加 `_remember_session(platform, chat_id, sid, cwd)`：id 变了就落库
并 `session` 事件；只要 `sid` 与 `cwd` 都有就 `attach_session`（宿主侧幂等）。

调用点：`wake` 打断旧 turn 后（用 `old.cwd`）、`_run` 每轮结束（即使 id 未变）。
`interrupt()` 也把在飞 turn 的 `session_id/cwd` 申报一次再终止。
`server._announce_all()` 改用有效工作区解析，开机把跟随默认工作区的存量会话也补挂。

### 4. 面板接线

- `S.addWs` 初值顺序：本地面板记忆 → 现有会话里最近使用的工作区 → DSH 默认；
  每次用户选工作区都写回记忆。
- 新 helper `joinWatch(platform, chat_id, name, kind)`：统一带
  `workspace: S.addWs || S.defaultWs`；所有「加入值守」入口改用它，toast 写明落在
  哪个工作区。
- 会话详情的工作区行从「已值守才显示」改为**常显**；未值守时提示「加入值守后
  生效」。值守开关、`现在处理`、`新建会话` 都带当前选择的工作区。
- 实例卡 / 详情在 `workspace=""` 时显示「跟随 DSH 默认：<title>」而不是
  「未绑定工作区」；显式路径不存在时继续显示警示，并禁止「现在处理」以免跑错目录
  （下一轮命中会失败并显示原因）。
- `newSessionBtn` 的确认文案与 toast 写明下一次会落在哪个工作区。

### 5. 响应字段

`/api/chats` 每行补：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workspace_effective` | string | 实际会用的 cwd（显式或 DSH 默认） |
| `workspace_effective_title` | string | 上面的展示名 |
| `workspace_fallback` | bool | true=该行没显式绑定，跟随 DSH 默认 |
| `workspace_missing` | bool | true=显式绑定的目录已不存在 |

`/api/chat/session` 的 `workspace` 对象沿用 `resolve_for_chat`，新增
`source` / `fallback` 两个键。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 未绑工作区时禁止唤醒，逼用户先选 | 会打断存量值守；空值本身有「跟随 DSH 默认」的合法语义，问题在 UI 不说实话 |
| 改工作区时自动把旧会话复制/迁移到新目录 | DSH 会话按 cwd 落盘，插件不写 DSH 存储；复制会让历史与锁状态分叉 |
| 只在 UI 记住上次工作区，服务端不改 | 改工作区仍会留下错位 session、打断路径仍漏挂，问题会复发 |
| 把两个宿主合并成一个轮询者 | 涉及进程选举与 DSH 生命周期，超出本次 bug 修复范围 |

## 影响面

- 代码：
  - `dsh-plugin/service/workspaces.py`、`turns.py`、`dshrun.py`、`server.py`
  - `dsh-plugin/web/panel.js` + 重新构建的 `dsh-plugin/lib/client.js`
- 契约：`01-api.md`（`/api/watch`、`/api/chat/workspace`、`/api/chat/wake`、
  `/api/chat/session/reset`、`/api/chats` 新字段）、`02-storage.md`（`workspace`
  空值语义）。
- 用户可见：加入值守时必须能看到/选择工作区；改工作区会解绑旧会话并提示；
  不存在的显式工作区会明确报错而不是换目录跑。
- 兼容：老 `chats.workspace=""` 继续跟随 DSH 默认；老客户端只传 `workspace`
  仍可用；按契约传 `path` 的新调用也能用。

## 验收

- [x] `turns.wake`：`chats.workspace=业务工作区`、调用方不传 workspace → `dshrun.start`
      收到 `workspace=业务工作区`；值为空 → 收到 DSH 默认路径。
- [x] `chats.workspace` 指向不存在的目录 → 不启动 turn，`last_reason` 含
      `workspace_missing`，面板显示失败原因。
- [x] 已绑会话在旧工作区时改到新工作区 → 旧 turn 被打断、`dsh_session` 清空、
      发 `session(workspace_changed)`；改到会话所在工作区 → 保留绑定。
- [x] 打断在飞 turn 时发出 `attach_session`（带旧 turn 的 cwd），会话能在 DSH
      侧边栏对应工作区里看到。
- [x] `/api/chat/wake` 带 `workspace` 时先落工作区再唤醒；`/api/chat/session/reset`
      带 `workspace` 时先落工作区再解绑。
- [x] 面板所有「加入值守」入口都带工作区；详情页未值守也能选工作区；toast /
      实例卡显示实际工作区（含「跟随默认」）。
- [x] 契约 01 的 `path` 与 UI 的 `workspace` 都能设置成功；只传空 `workspace`
      不会误清已有绑定。
- [x] `python3 -m unittest discover -s tests` 与 `bash scripts/gate.sh` 全绿
      （86 条插件测试；并行 0012 的契约与测试隔离补齐后复跑）。

## 风险与回滚

- 风险：改工作区会打断在飞 turn，agent 已发出的消息不会撤回；确认文案里写明。
- 风险：显式目录失效时 turn 失败而不是继续跑，用户会看到「上一轮失败」；这是
  有意的安全取舍。
- 回滚：本次改动集中在工作区解析、turn 启动参数与面板入口，可整体 revert；
  DB 无需迁移，老行 `workspace=""` 行为保持不变。
