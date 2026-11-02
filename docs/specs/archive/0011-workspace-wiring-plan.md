# 0011 工作区接线 — 实施计划

> 关联 spec：`docs/specs/archive/0011-workspace-wiring.md`
> 原则：一步一验证；先服务端，后面板；每步保持 `gate --quick` 绿。

## 1. 有效工作区解析（workspaces / dshrun / turns）

- [x] `workspaces.resolve_for_chat` 增加 `source` / `fallback`，显式路径失效不静默回退。
- [x] `dshrun.session_in_workspace`：空工作区返回假；`start()` 只接收有效路径。
- [x] `turns._spawn`：先 `resolve_for_chat`；显式 `exists=false` 直接失败
      （`workspace_missing`），否则把有效路径传给 `dshrun.start`。
- 验证：`python3 -m unittest dsh-plugin.tests.test_turns`；手工调用
  `workspaces.resolve_for_chat({"workspace": "/nope"})` 看 `exists=false`。

## 2. 会话申报与打断（turns）

- [x] 抽出 `_remember_session(sid, cwd)`：id 变了落库 + `session`，有 sid/cwd 必发
      `attach_session`。
- [x] `wake` 打断后用它（旧 turn 的 cwd）；`_run` 每轮结束用它；`interrupt()` 也
      申报在飞 turn。
- [x] `server._announce_all` 用有效路径。
- 验证：`test_turns` 新增断言——打断后事件里有 `attach_session`，且续聊 id 未变
  时仍有 attach。

## 3. 改工作区原子化（server）

- [x] 新增 `_apply_workspace`（校验、比较有效路径、打断、按需解绑、写列）。
- [x] `/api/chat/workspace` 接受 `workspace` / `path`；缺参数报错，显式空串才解绑。
- [x] `/api/watch` 带 `workspace` 时走 `_apply_workspace`；空串不改变绑定。
- [x] `/api/chat/wake`、`/api/chat/session/reset` 接受可选 `workspace`，先落再执行。
- [x] `/api/chats` 补 `workspace_effective` / `_title` / `workspace_fallback` /
      `workspace_missing`；`/api/chat/session` 沿用 `source` / `fallback`。
- 验证：新增 `tests/test_workspace_wiring.py`，用临时 DB + 假 turn 断言解绑/保留/
  打断；`test_stdio` 回调核对路由仍可用。

## 4. 面板接线（panel.js → client.js）

- [x] `S.addWs`：面板记忆 → 最近使用工作区 → DSH 默认；选择后写回。
- [x] `joinWatch()` 统一带工作区，替换详情开关 / 群卡片 / 找群 / 人名搜索。
- [x] 详情工作区行常显；值守开关、现在处理、新建会话带当前选择。
- [x] 空工作区显示「跟随 DSH 默认：<title>」；显式目录缺失时警示并禁用现在处理。
- [x] `newSessionBtn` 文案写明下一次落在哪个工作区。
- [x] `python3 scripts/build_client.py` 重建 `lib/client.js`。
- 验证：`node --check`、`gate --quick` 的构建产物对账；3080 面板点一遍（见 §6）。

## 5. 文档与契约

- [x] `docs/specs/contracts/01-api.md`：新参数、新字段、POST 方法。
- [x] `docs/specs/contracts/02-storage.md`：`workspace` 空值 = 跟随 DSH 默认。
- [x] `dsh-plugin/README.md`：加入值守与换工作区的实际行为。
- [x] `CHANGELOG.md` 0.8.0 小节补一条修复。
- [x] `PROGRESS.md` 断点 + 当日 log。

## 6. 真机验证

- [ ] 在 3080 面板用「分身 → 加入值守」选 业务工作区 加一个测试会话，确认
      `chats.workspace` 与 toast 一致。
- [ ] 有积压时点「现在处理」，确认新 session 目录落在 业务工作区，且
      `workspace.json` 的 业务工作区 `sessionIds` 出现它。
- [ ] 把该会话改到另一个工作区，确认在飞 turn 被打断、旧绑定清空、UI 提示；
      再改回 业务工作区，确认下一轮在 业务工作区新建。
- [x] 选一个不存在路径 → 加入/绑定被拒；已绑目录被删后点现在处理 → 明确失败
      不换目录。
- [x] `python3 -m unittest discover -s tests`、`bash scripts/gate.sh` 全绿（86 条）。
