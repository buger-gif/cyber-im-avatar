# 契约 01 · API

> **冻结契约**。路由集合由 `tests/test_docs.py` 与 `dsh-plugin/lib/app.js` 的
> `ROUTES` / `POST_ROUTES` / `DELETE_ROUTES` 逐条对账：多了、少了、改名了都会红。
> 加路由必须同 commit 改这里。
>
> 传输是 DSH 自己的同源路由 `/plugins/im-standin`，插件不监听任何端口。
> 浏览器请求直接进宿主进程里的 `App.handle()`，没有 stdio 子进程。

## 读接口（GET）

| 方法 | 路径 | 主要入参 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | 存活探针，带 pid 与 `transport=node` |
| GET | `/api/status` | — | 总状态：counts、poll、platforms、dsh、instances、turns、running。`platforms` 恒为三项（feishu / wecom / dingtalk），每项带 `enabled`；未启用的不跑 `whoami` |
| GET | `/api/inbox` | `filter`、`limit`、`group` | 收件箱；默认按会话聚合，`group=msg` 逐条；只从每会话最近 10 条派生 |
| GET | `/api/inbox/cleanup` | — | 把未值守会话的待回批量标成 ignored |
| GET | `/api/thread` | `platform`、`chat_id`、`fetch`、`limit` | 会话正文：默认在线拉 30 条；`fetch=1` 先补拉分类（**只读，不唤醒**；冷却中直接用本地指针）；失败回退本地 10 条并带 `offline` / `error` |
| GET | `/api/chats` | — | 会话清单，含 `blocked` / `timer` / `timed` / `watching` / `dsh_session` / `session_turns` / `turn_state`；工作区字段见下 |
| GET | `/api/send` | `platform`、`chat_id`、`text`、`msg_id` | 以本人身份发出；不写发送历史 |
| GET | `/api/state` | `platform`、`msg_id`、`state`、`chat_id` | 改最近 10 条里的一条：new / opened / replied / ignored；更早的返回 `not_cached` |
| GET | `/api/watch` | `platform`、`chat_id`、`watching`、`name`、`kind`、`workspace` | 加入 / 移出值守；`workspace` 非空时一并绑定，空串不改变已有绑定。群加入值守默认 `timer=1` + `wake_mode=mention`（只盯 @我）；要全量得显式调 `/api/chat/mode` |
| GET | `/api/unwatch` | `platform`、`chat_id` | 移出值守（保留目标与最近指针） |
| GET | `/api/search` | `platform`、`q` | 在线搜人；每条含 `id`、`chat_id`（可空，飞书为 `p2p_chat_id`）、`name`（仅可读名称）、`department` |
| GET | `/api/search/chats` | `platform`、`q` | 按名字搜会话（找群用）；`name` 为空时表示没有可读群名，不回退 `chat_id` |
| GET | `/api/chat/timer` | `platform`、`chat_id`、`timer` | 定时拉开关：-1 / 0 / 1；群默认 -1 |
| POST | `/api/chat/mode` | `platform`、`chat_id`、`mode`、`name`、`kind` | 群的关注程度一档三态：`off` / `mention` / `all`，一次写 `watching` / `timer` / `wake_mode`；`off` 会取消在飞 turn，`all` 只对群生效（私聊返回 `只对群生效`） |
| GET | `/api/chat/block` | `platform`、`chat_id`、`blocked` | 屏蔽 / 取消屏蔽（屏蔽即不同步） |
| GET | `/api/poll` | `platform`、`chat_id` | 立即拉一轮；带会话=只拉它并同步返回，不带=后台跑整轮，结果从 `/api/status` 的 `poll.last_result` 读。受 `cooldown_sec` 约束；post-turn 补拉是唯一 `force` 例外 |
| GET | `/api/pause` | `paused` | 暂停 / 恢复定时轮询（不取消在飞 turn） |
| GET | `/api/doctor` | — | 体检：身份、拉取通路、DSH 宿主、skill 路径、拉取节奏 |
| GET | `/api/config` | — | 读配置；模型/凭据全在 DSH，插件无 api_key 可回传 |
| GET | `/api/workspaces` | — | 可选工作区列表（值守会话绑定用） |
| GET | `/api/targets` | — | 服务对象画像：`profile` / `profile_path` / `profile_updated_at` / `profile_excerpt` |
| GET | `/api/chat/workspace` | `platform`、`chat_id`、`workspace`（别名 `path`） | 给值守会话绑 / 解绑工作区；必须显式给键，空串=解绑 |
| GET | `/api/chat/session` | `platform`、`chat_id` | 查当前绑定的 DSH 会话与工作区 |
| GET | `/api/logs` | — | 最近轮询错误与在飞 turn 快照（不落盘、不进日志正文） |
| GET | `/api/digest` | `date`（`YYYY-MM-DD`，默认今天） | 只读 `~/.im-standin/digest/<date>.md`（agent 维护）：`{ok, date, exists, text, mtime}`；日期非法 `bad_date`；不建目录、不解析、不统计 |

### `/api/chats` 的工作区字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workspace` | string | 显式绑定；空串=跟随 DSH 默认 |
| `workspace_title` | string | 显式绑定的展示名（空绑定为空） |
| `workspace_in_dsh` | bool | 显式路径是否在 DSH 登记表里 |
| `workspace_exists` | bool | 显式路径是否还在（空绑定为 false） |
| `workspace_effective` | string | 实际会用的 cwd（显式或 DSH 默认） |
| `workspace_effective_title` | string | 上面的展示名 |
| `workspace_fallback` | bool | true=未显式绑定，跟随 DSH 默认 |
| `workspace_missing` | bool | true=显式绑定的目录已不存在（turn 会明确失败） |

## 写接口（POST 覆盖）

`POST` 默认回落到 `ROUTES` 里同名 handler；下列路径有**独立的写入实现**，必须走 `POST_ROUTES`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/config` | 写配置；`poll.interval_min` 夹到 ≥10 |
| POST | `/api/platforms` | 启用 / 停用平台：入参 `platform`、`enabled`；只接受 `feishu` / `wecom` / `dingtalk`，写回 `config.platforms`（按固定顺序去重） |
| POST | `/api/targets/profile` | 覆盖写一份服务对象画像；入参 `platform`、`name`、`text`（≤12KB，超限拒绝不截断） |
| POST | `/api/chat/session/reset` | 新建会话：可带 `workspace` 先落工作区；打断在飞 turn、清空 `dsh_session`，下次命中开新会话 |
| POST | `/api/chat/wake` | 手动唤醒：可带 `workspace` 先落工作区；把该会话最近待回交给 agent，不等新消息；`running` / `blocked` / 未值守时拒绝 |

## 删除接口（DELETE）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| DELETE | `/api/forget` | 删除该会话的状态与画像文件；不删线上消息，也不删 DSH 会话文件 |

## 约定

- **入参位置**：`GET` 走 query string，`POST` / `DELETE` 走 JSON body；同名键含义一致。
- **返回值**：一律 JSON 对象；写操作成功带 `{"ok": true}`，失败带 `{"ok": false, "reason": "…"}`。
  路由不存在给 404，handler 抛异常给 500。
- **敏感字段**：插件不持有模型 key；错误信息进 `poller.errors`/状态前要过平台适配层的脱敏。
- **新增路由的顺序**：先改本文件 → 改 `dsh-plugin/lib/app.js` 的 `ROUTES` /
  `POST_ROUTES` / `DELETE_ROUTES` → 面板接上 → 跑 `bash scripts/gate.sh --quick`。
