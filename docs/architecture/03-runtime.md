# 03 运行时 — 装在 DSH 里，唤醒就是宿主内的一轮

> 目标态描述。改了安装方式、唤醒路径或日志位置，改这篇 + `docs/implementation/runbooks/`。

## 装

```bash
# 本地目录（改代码时用这个；插件目录被 DSH 直接引用）
dsh plugin --profile web add ~/cyber-im-avatar/dsh-plugin
dsh web                     # 侧边栏底部出现「IM 值守」

# npm 包（已发布 dsh-cyber-im-avatar）
dsh plugin --profile web add dsh-cyber-im-avatar
```

插件只在**带 `webServer` 能力的 profile**（`web` / 桌面）里挂路由并启动轮询；`headless`
不挂路由也不起轮询。宿主服务通过 `ctx.inject` 拿 `workspaceRegistry`、`sessionController`、
`sessions`、`webServer`，以及可选的 `attachments` / `llm`（缺了按文本+本地路径降级）。

## 唤醒：同一个 agent，不再起子进程

```
poller 判定命中
  └─ turns.wake(chat)
       ├─ 先取消同会话在飞 turn（agent.inbox.remove / agent.cancel）
       ├─ 闲置超阈值先解绑旧会话：这一轮进新会话
       ├─ resolveAgent(dsh_session) 或 create({workspaceId|cwd})
       ├─ 每次唤醒只追加本次新消息（首轮带入口、会话工作本与人物档案路径，
       │  之后只发消息行 / 本会话还没给过的人的档案行）
       ├─ 只对本批待回消息下载媒体：图片 → attachments image block，
       │  文件/音视频 → 本地路径；未适配/失败只留标记
       ├─ agent.followup(createUserMessage(prompt, imageParts))
       ├─ ctx.sessions.flush(agent.session)
       └─ 听 session/event：turn/start → user/message(id 匹配) → turn/end
```

- 一通 IM 会话 ↔ 一个 DSH 会话（`chats.dsh_session`），默认复用。手动「重开会话」
  （解绑后立刻在值守中开新会话）、工作区漂移、会话丢失，或闲置超过 `dsh.idle_reset_min`
  （默认 180 分钟）后的下一条消息，都会换新会话；旧会话留在侧边栏。显式工作区目录存在但未在
  DSH 登记时，仍先尝试恢复旧会话。
- 闲置达到 `dsh.warm_min`（默认 55 分钟）、又没到重开阈值时，轮询器起一轮「值守心跳」：
  在已绑定会话里续上下文缓存，并让 agent 按 skill 规则整理载荷列出的文件（会话工作本 +
  最多 3 份人物档案），不扫目录。它不写 `session_turns` /
  `last_turn`，真实消息到达即取消；结果记 `chats.last_warm_at` / `last_warm_ok`。
- 首轮带 `/cyber-im-avatar`、平台/对象、chat_id、运行形态、`会话工作本`路径与本次发言人的
  「人物档案」路径（≤5，去重、@我优先）；之后同一 `dsh_session` 只发本次新消息行，
  不再重复这些说明。`chats.prompt_session == dsh_session`
  时判定为后续轮；换会话/重置会清空，下一次重新带完整上下文。
- 画像只给路径：会话工作本 `~/.im-standin/profiles/<platform>/<chat_id>.md`、人物档案
  `~/.im-standin/profiles/people/<platform>/<person_id>.md` 都由 agent 自己读、自己改；
  插件不解析回复、不代写。`dsh.full_access=true` 时插件在 followup 前把会话切到
  `danger-full-access`，否则 `workspace-write` 会拒绝写画像目录。
- 因为就是宿主里的 live agent，DSH UI 打开同一会话不再是锁问题；只有**另一个
  DSH 宿主持有写锁**时才报 `session_locked_other_host`。所以同一份 state 只让一个宿主写。
- `turn/start` 先于 `user/message` 是正常顺序；匹配 prompt id 后取 turn 号，等同一 turn 的 `turn/end`；不再收集 assistant 正文。
- 单轮守时：`dsh.timeout`（默认 600s）是**停滞**阈值，本轮每来一条 `session/event` 就重置；`dsh.turn_cap_sec`（默认 3600s，0 = 不限）从本轮开始计时做总上限、不随活动重置；两种超时/取消都 `agent.cancel`，`last_turn.reason` 记 `timeout` / `turn_cap`，没有 pending 的手动唤醒返回 `no_pending`。
- **点开只读**：`/api/thread?fetch=1` 只补拉分类，不唤醒、不推进水位；显式唤醒只走
  `POST /api/chat/wake`。手动 `/api/poll` 受 `cooldown_sec` 约束，post-turn 补拉是唯一 `force` 例外。
- 富媒体失败只降级：下载超时/失败/未适配写进 prompt；媒体 7 天/单会话 200MB 清理。

## 配置

键、默认值、取值范围以 `docs/specs/contracts/03-config.md` 为准（测试对账）。

- `poll.interval_min` 有硬下限 10 分钟，填 1 会被夹回 10——不是在防备谁，是不想把 IM 接口当靶子打。
- `poll.dm_scope` 是 legacy no-op：老配置还能加载，实际候选只看 `watching` 私聊，群只有 `timer=1`。
- `dsh.full_access` 默认 `false`；为 `true` 时插件把值守会话切到 `danger-full-access`，agent 才能写工作区外的画像。这是唯一放开沙箱的开关。
- `dsh.idle_reset_min` / `dsh.warm_min` 控制会话寿命与保温（默认 180 / 55 分钟，0 = 关闭）；重开开启时保温只在重开窗口内跑，且不推进闲置时钟；两个 0 各自关闭。
- 平台白名单只有 `feishu` / `wecom`；`platforms` 里其他值被忽略，存量钉钉会话保留不拉取。
- 风险拦截在 skill 铁律里（钱、承诺、对外群由 agent 停下等本人），插件不再有 `reply_guard` 开关。

## 日志与排障入口

| 想看什么 | 去哪 |
| --- | --- |
| 轮询在干什么、有没有报错 | `~/.dsh/web.log`（宿主 stdout）+ 面板「体检」页 |
| 单个接口返回什么 | 面板同源 fetch；没有端口可 curl，也没有 rpc.py |
| 体检（CLI / 授权 / 通路 / DSH / skill） | 面板「体检」按钮 → `GET /api/doctor` |
| 面板白屏 / 401 / 宿主没起来 | `docs/implementation/runbooks/troubleshoot.md` |

运行期不写轮询日志文件：`poller.errors` 只在内存里留最近 40 条，重启清零；
正文与凭据不进日志。

## 升级

- `state.json` 新字段由 `State.load()` 补默认值，只会放宽不会改变行为（见 `docs/architecture/02-data.md §迁移策略`）。
- 从 0.8.x 升级先跑 `node scripts/migrate-state.mjs`；旧 `panel.db` 改名保留，运行期不再读。
- 面板前端 `lib/client.js` 是 `web/panel.js` 的构建产物，**必须同步提交**；
  `scripts/gate.sh` 会重跑构建并比对，忘了重建会红。
- 版本号三处必须一致：`dsh-plugin/package.json`、`CHANGELOG.md` 顶部小节、git tag。同样是闸门检查项。
