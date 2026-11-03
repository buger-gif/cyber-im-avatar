# 0013 Node 单进程 skill 壳

> 状态: 已验收
> 编号: 0013
> 版本: 0.8.0
> 关联: `docs/specs/contracts/01-api.md`、`02-storage.md`、`03-config.md`、`docs/architecture/01-shape.md`、`02-data.md`、`03-runtime.md`、`docs/decisions/implemented/0005-node-single-process.md`

## 背景

0.8.x 的插件链路是 Python 后端 + Node 宿主 + SQLite + `dsh headless` 子进程。
为了「管一个 skill」多出了四层：stdio 协议、SQLite 表与迁移、headless 会话锁、
Python/Node 两套测试。真实故障也集中在这几层：DSH UI 打开会话后持有
`session.lock`、headless 唤醒报 `session_locked`、消息与待回状态跨进程不同步。

用户明确要求：除 UI 外全部推倒，用 Node 重写；这就是一个 skill 的壳；缓存消息
只保留 10 条，完整上下文线上 IM 都有。

## 目标与非目标

- 目标：
  - 插件后端只跑在 DSH 宿主进程内，Node 标准库，零运行时第三方依赖；
  - 唯一本地状态 `~/.im-standin/state.json`，每会话最多 10 条消息指针；
  - 命中唤醒绑定 DSH 会话里的 live agent，不再起 headless 子进程；
  - 面板契约、五个 tab、右侧栏停靠、浅/深色、401 reload 全部不变；
  - 旧 `panel.db` 一次性迁到 `state.json`，运行期不再读 SQLite；
  - 删除 Python 服务、stdio、SQLite、`attach_session`、`rpc.py` 与 Python 插件测试。
- 非目标：
  - 不改 UI 布局/文案/路由/字段，不新增第三方依赖，不监听端口；
  - 不做本地完整消息历史、发送历史或离线归档；
  - 不替企微/钉钉造消息 ID；不改变 skill 的铁律与平台矩阵；
  - 不自动向真实客户发送；真实命中验证由用户指定会话。

## 方案

### 模块

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | 同源路由 `/plugins/im-standin`、token、面板注入、装 skill、`ctx.inject` |
| `lib/app.js` | 面板 API；`ROUTES` / `POST_ROUTES` / `DELETE_ROUTES` |
| `lib/state.js` | `state.json` 归一化、收件箱派生、原子写 |
| `lib/poller.js` | 10 分钟轮询、值守候选、分类、唤醒判定、post-turn 补拉 |
| `lib/im.js` | 飞书/企微 CLI 适配、@我判定、脱敏 |
| `lib/turns.js` | live turn：resolve/create、followup、等 `turn/end`、取消、画像回写 |
| `lib/profiles.js` / `workspaces.js` / `sessions.js` | 画像文件、DSH 工作区只读、会话路径 |

### 状态

- `state.json` 顶层 `{version, config, paused, runtime, chats}`；每个 chat 有
  `watching/blocked/timer/workspace/dsh_session/last_epoch/wake/recent`。
- `recent` 最多 10 条、最新在前；只有 `new/opened` 的 `dm/mention/service` 保留正文。
- 未读/待回/收件箱全部从 `recent` 派生；没有 messages/sends 表。
- 原子写 + `.bak` + 0600；一个 DSH 宿主写。

### 唤醒

- `sessionController.resolveAgent(dsh_session)`；不存在则 `create({workspaceId|cwd})`
  再 `resolveAgent` 拿 live agent。
- `agent.followup(createUserMessage(prompt))` → `sessions.flush()`；听 `session/event`：
  `turn/start` 先到、`user/message` 匹配 prompt id、`assistant/message` 取
  `data.message.content`、同 turn 的 `turn/end` 收尾。
- 新消息取消旧 turn；工作区 missing 明确失败；cwd 漂移才重开会话。
- prompt 首行 `/cyber-im-avatar`，带「运行形态：DSH 插件壳」、画像、最近 10 条。

### API / UI

- 保留面板现有全部路由；`/api/forget` 改为 `DELETE`。
- `/api/state` 只对 `recent` 里的消息生效，更早返回 `not_cached`。
- 画像上限 12KB，写回带 mtime CAS；target 重名自动加后缀。
- `web/panel.js` 与 `lib/client.js` 不改。

### 迁移

`node scripts/migrate-state.mjs`：读旧 chats + 每会话最新 10 条 + `panel.json` +
`env.json` 目标索引 → `state.json`；旧库改名 `panel.db.migrated`；`--fresh` / `--force`。

## 验收

- [x] `lib/` 全 Node、`node --check` 全过；`service/`、`rpc.py`、Python 插件测试已删。
- [x] `node --test` 51 条全过：state/profiles/im/poller/turns/app/migration。
- [x] 契约 01/02/03 与 `tests/test_docs.py` Node 探针对账一致。
- [x] 真实目录迁移：73 会话 / 5 目标 / 每会话 ≤10 条；`panel.db.migrated` 生成。
- [x] 3080 启动 `[im-standin] ready`；status/inbox/thread/chats/targets/workspaces 正常。
- [x] 面板五 tab、右侧栏、浅/深色无 JS 异常；UI 文件未改。
- [x] 合成会话 live turn：`turn/end` 收尾、`session_turns+1`；重启复用同一 `dsh_session`。
- [x] 屏蔽/取消在飞 turn 路径实测；测试会话与画像已清理。
- [x] 真实客户会话的全链路命中验证（等用户指定的测试会话/真实新消息）。
      2026-11-03 用合成会话 `oc_e2e_local_only`（无效 chat_id，无外发）在 DSH 3080 上补齐：
      `chatWake` 创建 `session-76a20026…` → turn/end 收尾（`turn_state=idle`）→
      `session_turns` 0→1、`last_ok=true`、post-turn `last_sync` 更新；
      **真实客户消息待命中**，未在真实会话上触发。
- [x] 0.8.0 提交、tag、发版（用户确认后）。已完成：`v0.8.0` tag 存在，
      `dsh-plugin/package.json` 与 `CHANGELOG.md` 顶部为 0.8.0；npm 线上 latest 0.8.0
      （见 `docs/implementation/PROGRESS.md`）。
