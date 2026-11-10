# PROGRESS — 当前断点

> **新会话第一读取点。** 这份文件只回答三个问题：现在到哪了、什么被挂起了、下一步动哪里。
> 写法见 `docs/AGENTS.md`：活文档，就地改写，不做历史（历史在 `docs/implementation/log/`）。

## 更新时间

2026-11-10（web 启动审计误报已止损，spec 0042：client 半 `immediately` + 宿主入口懒加载；DSH 上游补丁草稿已落 audit）。\n\n2026-11-09（spec 0040 值守分诊已验收并归档：私有值守台 + 决策文件 + 两段式 + Feishu @我 搜索 + 群成员 >10 硬门；spec 0039 / 0038 待真机验收；0.18.2 已发布）

## 最近批次

| 日期 | 主题 | 证据 |
| --- | --- | --- |
| 2026-11-10 | 启动竞态止损（0042）：`dsh.client.immediately` + 宿主入口只静态依赖 Node 内置（导入 ~12ms→~4ms）；诊断与 DSH 上游补丁草稿见 `docs/audits/2026-11-10-web-boot-audit-race.md` | `dsh-plugin/package.json`、`dsh-plugin/lib/index.js` |
| 2026-11-09 | 值守分诊（0040 / ADR 0012）：新群基线、探针、私有值守台、决策文件 watch/trial/ignore（只 mention）、可选试用、两段式（新建一次 + 新 @ 再判）、Feishu `--is-at-me` 搜索 / DingTalk 回退、群成员 >10/未知硬门、API/面板/9 键/测试/契约；已验收归档；安装时写入 policy.md 初始版本 | `dsh-plugin/lib/duty.js`、`dsh-plugin/lib/poller.js`、`docs/specs/archive/0040-值守分诊.md` |
| 2026-11-09 | 0.18.0 发布：值守分诊（0040）进 npm latest 与市场索引；CI Trusted Publishing 成功，`v0.18.0` tag；`market/index.json` 指向 0.18.0 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、[run 42582621666](https://github.com/buger-gif/cyber-im-avatar/actions/runs/42582621666) |
| 2026-11-09 | 0.18.1 修复：飞书完整基线群 ID 快照，第一页之后的旧群不再排 `added`；升级清 queued added；值守台每次新建会话、短 prompt；npm latest 与市场索引指向 0.18.1 | `dsh-plugin/lib/{poller,im,turns,state}.js`、`tests/`、`docs/specs/active/0041-值守分诊基线快照与一次性判断.md`、[run 42593008639](https://github.com/buger-gif/cyber-im-avatar/actions/runs/42593008639) |
| 2026-11-09 | 0.18.2 优化：自动分诊在起 desk turn 前查人数；>10 或未知直接 ignore，不拉消息、不花 token；手动仍可强制；npm latest 与市场索引指向 0.18.2 | `dsh-plugin/lib/poller.js`、`tests/poller.test.mjs`、`CHANGELOG.md`、[run 42598641908](https://github.com/buger-gif/cyber-im-avatar/actions/runs/42598641908) |
| 2026-11-06 | 群聊里 @ 自己也算指令（spec 0039 / ADR 0011）：`isCmdMsg` 去掉群限制；全量群批次收 `cmd`，指令不等合并窗口；载荷加「群里默认只在本地处理」；契约 02、架构 02、README、CHANGELOG 同步 | `dsh-plugin/lib/{poller,turns,profiles}.js`、`tests/{poller,turns}.test.mjs`、`docs/specs/contracts/02-storage.md`、`docs/architecture/02-data.md`、`dsh-plugin/README.md`、`docs/decisions/implemented/0011-群聊自at也算指令.md` |
| 2026-11-06 | 外来轮次打断与 turn 事件日志（spec 0038）：`wake` 用 `agent.status` 识别并打断非插件起的在飞轮次；steer 载荷按当前轮收口；看门狗只统计载荷进入会话后的事件；`logs/turns.jsonl` 落盘、体检页「最近事件」、`/api/logs.events` | `dsh-plugin/lib/{turns,app,index,turn-log}.js`、`web/panel.js`、`lib/client.js`、`tests/`、契约 01/02、spec 0038 |
| 2026-11-06 | 0.16.0 发布：命中回执表情（spec 0037）进 npm latest 与市场索引；CI Trusted Publishing 成功，`v0.16.0` tag 与 `market/index.json` 一致 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、[run 42178230488](https://github.com/buger-gif/cyber-im-avatar/actions/runs/42178230488) |
| 2026-11-06 | 命中回执表情（spec 0037，已验收归档）：`followup` 被接受后给本批 @ 消息点 `Get`；只认群 `mention` 与私聊「只认 @」的 `dm`，仅飞书，失败不影响 turn；新键 `dsh.ack_reaction` 默认开，设置页可关 | `dsh-plugin/lib/{state,im,turns}.js`、`web/panel.js`、`lib/client.js`、`tests/`、契约 03、`README.md`、`dsh-plugin/README.md`、`references/feishu.md`、`CHANGELOG.md`、`docs/specs/archive/0037-命中回执表情.md` |
| 2026-11-06 | 0.15.0 发布：保温只做一次 + 单聊只用人物档案进 npm latest 与市场索引；CI Trusted Publishing 成功，`v0.15.0` tag 与 `market/index.json` 一致 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、[run 42171965913](https://github.com/buger-gif/cyber-im-avatar/actions/runs/42171965913) |
| 2026-11-06 | 保温只做一次（spec 0036 / ADR 0010）：每段连续闲置最多一次心跳；第二个 `warm_min` 仍无真实消息则下一条消息换新会话；`dsh.idle_reset_min` 退役，`warm_min=0` 同时关保温与自动换会话；面板设置只剩保温间隔 | `dsh-plugin/lib/{state,poller,turns}.js`、`web/panel.js`、`lib/client.js`、`tests/`、契约 02/03、`README.md`、`dsh-plugin/README.md`、`CHANGELOG.md`、`docs/specs/archive/0036-保温只做一次.md`、`docs/decisions/implemented/0010-会话寿命跟随保温节奏.md` |
| 2026-11-05 | 单聊只用人物档案（spec 0035）：私聊记忆＝`profiles/people/<platform>/<id>.md` 一份，不再建/展示/下发工作本；旧私聊工作本第一次被碰到时整文件改名（已有档案则载荷给「待并入」+ `.history.md`）；面板删「私聊工作本」入口，`/api/targets` 与写接口对 p2p 走人物档案，独立形态搜人登记绑人物档案 | `dsh-plugin/lib/{profiles,turns,app}.js`、`web/panel.js`、`lib/client.js`、`scripts/bootstrap.py`、`tests/`、契约 01–03、`SKILL.md`、`README.md`、`docs/specs/active/0035-单聊只用人物档案.md`、ADR 0009 |
| 2026-11-05 | 关注页日报即时渲染（spec 0033）：模块级缓存 + 席位页面加载预热，打开页签同步出内容（接口延迟 800ms 下 825ms → 7ms）；可见时 3 秒静默刷新，内容不变不重建 DOM、滚动保持；失败保留内容并挂错误条 | `dsh-plugin/web/panel.js`、`lib/client.js`、`CHANGELOG.md` |
| 2026-11-05 | 单轮停滞超时（spec 0034）：`dsh.timeout` 从单轮墙钟上限改成停滞阈值（`session/event` 即重置），加 `dsh.turn_cap_sec`（默认 3600，0=不限）兜总时长；时间线证据见当日 log | `lib/turns.js`、`lib/state.js`、`web/panel.js`、契约 03、`tests/turns.test.mjs`、`tests/test_docs.py` |
| 2026-11-05 | 面板去掉收件箱页（spec 0032）：删页签与视图、行内未读红点 / 页签待回数 / 席位角标，默认页签改「分身」，详情从分身卡片与搜索进；`/api/inbox` 与派生保留 | `dsh-plugin/web/panel.js`、`lib/client.js`、`README.md`、`docs/images/`、`dsh-plugin/screenshots.json` |
| 2026-11-05 | 画像两层拆分（spec 0031 / ADR 0008，已归档）：人物评价按平台发送者 ID 一份 `profiles/people/<platform>/<id>.md`，会话文件只留群规/工作要求/成员指针；首轮载荷给两类路径、心跳只整理列出文件；面板「服务对象」分对象/人物，`/api/persons` 三条（`base_mtime` stale）；独立形态 `--person-*` CLI；旧四段画像懒迁移 `.history.md`，不改 state、forget 只删工作本 | `dsh-plugin/lib/{profiles,turns,app}.js`、`web/panel.js`、`lib/client.js`、`scripts/bootstrap.py`、`tests/`、契约 01–03、`SKILL.md`、`docs/specs/archive/0031-人物档案与会话工作本.md`、`docs/decisions/implemented/0008-画像按人和会话拆两层.md` |
| 2026-11-04 | 面板去主题兜底（spec 0030）：删硬编码兜底色与深色覆盖块、8 个死类，颜色只读 DSH token；独立预览页自带假 token，浅/深截图逐像素一致 | `dsh-plugin/web/panel.js`、`dsh-plugin/scripts/demo/standalone.html`、`lib/client.js` |
| 2026-11-04 | 重开会话即开新会话 + 关注程度接线修正（spec 0027/0028）：解绑后立刻起开场轮、`busy()` 放行刚取消的旧轮、`off` 不改写模式、重新加入恢复拉取 | `lib/app.js`、`lib/state.js`、`lib/turns.js`、`lib/poller.js`、`web/panel.js`、契约 01/02、`tests/app.test.mjs` |
| 2026-11-04 | 私聊 @ 自己 = 对替身说话（spec 0029）：`kind=cmd` 进批次、载荷身份与防回环规则、10 分钟 5 次熔断 | `lib/poller.js`、`lib/state.js`、`lib/turns.js`、`web/panel.js`、契约 02、`tests/poller.test.mjs` |
| 2026-11-04 | 私聊仅 @ 唤醒（spec 0027）：`wake_mode` 扩到私聊、`state.version` 1→2 迁移、`mentionable` 能力位、面板私聊三态 | `lib/state.js`、`lib/poller.js`、`lib/app.js`、`lib/turns.js`、`web/panel.js`、契约 01/02 |
| 2026-11-04 | 0.12.0 发布：闲置重开 / 心跳 / skill 闲置退出进 npm latest 与市场索引 | `CHANGELOG.md`、`dsh-plugin/market/index.json` |
| 2026-11-04 | 闲置重开 + 值守心跳（spec 0026）：`dsh.idle_reset_min` / `dsh.warm_min`、`last_warm_at` / `last_warm_ok` / `last_reset`、设置页「会话生命周期」；skill 加 `--idle-exit-min 180` / `--new-watch` | `lib/turns.js`、`lib/poller.js`、`lib/state.js`、`web/panel.js`、`scripts/listen_core.py`、契约 02/03、`docs/implementation/log/2026-11-04.md` |
| 2026-11-03 | 进插件市场名单：条目 PR [#11669](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11669)，`screenshots.json` 进详情页，流程落 runbook | `docs/implementation/runbooks/market-listing.md`、`dsh-plugin/screenshots.json` |
| 2026-11-03 | 0024 / 0025 真机验收通过并归档（群三态 + 加入即开会话） | `docs/specs/archive/README.md` |
| 2026-11-03 | 加入值守即开会话（spec 0025）：`Turns.open()` + 开场载荷、`/api/watch` 与 `/api/chat/mode` 立刻起 turn | `lib/turns.js`、`lib/app.js`、`web/panel.js`、契约 01 |
| 2026-11-03 | 群聊关注程度（spec 0024）：`wake_mode` / `last_wake_at` / `last_wake_epoch`、合并窗口、`/api/chat/mode`、三态控件 | `lib/state.js`、`lib/poller.js`、`lib/app.js`、`web/panel.js`、契约 01–03 |
| 2026-11-03 | 面板体验加固（spec 0021）：草稿进内存、失败不装空、窄栏、密度、确认、可达、隐藏 imid | `web/panel.js`、`scripts/demo/fixture.mjs` |
| 2026-11-03 | 已有会话续跑只追加消息行，不再重复平台/chat_id/运行形态/画像路径/媒体说明 | `lib/turns.js`、`tests/turns.test.mjs`、`SKILL.md` |
| 2026-11-03 | 0013 / 0017 / 0018 / 0019 / 0020 / 0021 / 0022 逐条验收并归档；ADR 0006 转 implemented | `docs/specs/archive/README.md`、`docs/decisions/README.md` |
| 2026-11-03 | 合成 live turn：create → turn/end → post-turn；`session_turns+1`、agent 直接写画像 | 3080 + 临时状态目录，`docs/implementation/log/2026-11-03.md` |
| 2026-11-03 | 关注摘要：连续两次更新不重复、跨天保留「首次」；删除文件显示空态 | 3080 + 临时 `digest/` |
| 2026-11-03 | 重开会话：空闲重置 `interrupted:false`、运行中重置 `interrupted:true`，session 空、轮次 0 | 3080 合成会话 |
| 2026-11-03 | 快车道实测：`last_fast.at` 约 60 秒一跳，`last_result.at` 160 秒内不变 | 3080，临时状态目录 |
| 2026-11-03 | 每日关注摘要：插件只读 `GET /api/digest`，面板「关注」页签，日报归 agent（spec 0019） | `lib/app.js`、`web/panel.js`、`SKILL.md` |
| 2026-11-03 | 值守快车道：候选 60 秒、发现 10 分钟；`poll.fast_sec` 可关（spec 0022 / ADR 0007） | `lib/poller.js`、`lib/state.js`、`web/panel.js` |
| 2026-11-03 | 插件只追加消息、画像归 agent、`dsh.full_access`（spec 0018） | `lib/turns.js`、`lib/state.js`、`lib/profiles.js` |
| 2026-11-03 | 值守可靠性：双水位、whoami 暂停、@ 判定、富媒体交付（spec 0017） | `lib/poller.js`、`lib/im.js`、`lib/turns.js`、`lib/media.js` |
| 2026-11-03 | 钉钉真机：登录 → 取 userId → 真实会话命中 → 起草（发送未执行）；修 `+recent-conversations` 的 `data.conversations` 路径 | `scripts/bootstrap.py`、`references/dingtalk.md` |
| 2026-11-03 | 插件壳支持钉钉（spec 0023）：dws adapter、平台开关、体检页三平台与手动刷新 | `lib/im.js`、`lib/app.js`、`web/panel.js` |
| 2026-11-03 | 体检页可停用平台：有值守会话先确认，停用只停轮询 / 唤醒 | `web/panel.js`、`lib/client.js` |
| 2026-11-03 | 0.9.0 发布：npm latest、`v0.9.0` tag、市场索引；CI 自检改轮询 | `dsh-plugin/market/index.json`、`publish.yml` |
| 2026-11-02 | 插件重写为 Node 单进程（spec 0013）：state.json + live turn | `dsh-plugin/lib/`、`scripts/migrate-state.mjs` |

## 当前断点

- **0042 启动审计误报已实施，待真机**：冷启动不再把本插件报成 `import failed`；重启桌面 app 后看
  `~/Library/Logs/DeepSeek Harness/` 有没有新的 `crash-*-web-boot.log`，没有即通过。
- **0040 值守分诊已实施，待真机/全量 gate**：新群/被 @ 后由 agent 判断是否 watch / trial / ignore，插件只做发现、探针、排队、校验与执行；新群一律只盯 @我（分诊不产生 all，企微判不了 @ 只能 ignore）；判断在插件私有的 `<state.dir>/duty/` 工作区，不碰常规项目；值守台全局一个，按闲置/`session_max_turns` 轮换，`ignore`/`failed` 记录按 `record_keep_days` 清理；每 `sweep_min` 只处理基线之后、未值守的新群（存量群完全不扫）：Feishu 一条 `--is-at-me` 搜索直接拉 @我（@all 用 `isMention` 过滤），DingTalk 逐新群回退；新的个人 @ 触发 `trigger=sweep` 分诊（`ignore`/`failed` 可重开）。群成员 >`max_group_members`（默认 10）或未知 → 自动只能 ignore，插件拒绝 watch/trial；手动可强制。分诊轮不发言，决定值守后才起接手轮；成本是事件驱动，0 新群/无 @ 0 模型调用。代码在 `lib/duty.js` + `lib/poller.js` + `lib/turns.js` + `lib/app.js` + `web/panel.js`，契约 01/02/03 已改，Node 测试全绿，全量 gate 已过；真机未做。
- **0039 已实施，待真机验收**：群里本人 @ 自己现在与私聊同权，记 `kind=cmd` 进批次唤醒
  （「只盯 @我」与「全部消息」都算），不算待回；全量群不等 60 秒合并窗口；载荷要求指令默认
  只在本地处理、别在群里说「收到」。`node --test` 与 `gate --quick` 全绿。**剩余用户自验**：
  重启宿主（插件后端模块启动时加载）后，在在盯的群（`timer=1`）发 `@自己 …`，面板出现
  「处理中」，群里没有自动发言。
- **0038 已实施，待真机验收**：真实唤醒会打断绑定会话里**任何**在飞的 turn（含人在 DSH 面板里直接发消息、goal / 定时任务起的），不再只认插件自己的 active；被手动 steer 的载荷按当前轮收口，不再误报 `timeout`；turn 事件写 `~/.im-standin/logs/turns.jsonl`，体检页「最近事件」可看。`node --test` 215、Python 全量、`gate --quick` 全绿。**剩余用户自验**：在 DSH 面板里手动发一条长任务，再从群里 @，确认旧轮被打断、新载荷立刻起轮，体检页看到 `唤醒 → 打断(外来轮) → 已送达 → 进入会话 → 本轮结束`。
- **0037 已验收归档（随 0.16.0 发布）**：命中后给本批 @ 消息点 `Get` 表情回执；
  只认群 `mention` 与私聊「只认 @」的 `dm`，仅飞书，失败不影响 turn。用户已真机确认。
- **0.16.0 已发布**：CI Trusted Publishing 成功，`dist-tags.latest = 0.16.0`，`v0.16.0` tag 与
  `market/index.json` 一致；市场卡片描述同步为当前形态（不再写已删除的收件箱页）。
- **0036 已实施并归档（ADR 0010）**：每段连续闲置最多一次心跳，第二个 `warm_min` 仍无真实
  消息则下一条消息换新会话；`dsh.idle_reset_min` 退役，老配置静默丢弃，`warm_min=0` 同时关
  保温与自动换会话。`node --test` 198、Python 194、全量 gate 与独立预览页走查通过。
  **剩余用户自验**：宿主刷新后把 `warm_min` 临时调成 1，观察约 1 分钟保温一次、约 2 分钟后
  下一条消息换新会话，再把 `warm_min` 改回 55。
- **0035 已实施，待真机验收**：单聊只剩一份人物档案；群仍两层。`node --test`、
  Node 194 / Python 194 项、预览页 320/360/420 浅深色走查均通过。**剩余用户自验**：
  ①私聊命中载荷只有一行 `人物档案：`、agent 只改那一份；②旧私聊工作本已在第一次被碰到时改名
  （原文一字不改），下一轮 agent 整理成四段并把旧全文归档 `.history.md`；③钉钉私聊继续走
  工作本兜底，真机确认 `senderId` = `userId` 后再放开。
- **0032 已实施，待真机刷新验收**：面板只剩五个页签（关注 / 分身 / 服务对象 / 体检 / 设置），
  收件箱页与三处红色提醒已删；`/api/inbox` 与 `state.inbox()` 保留，供 `/api/status` 计数、
  详情「现在处理」与排障。独立预览页 320 / 360 / 420 宽与浅 / 深色已走查；**真实 DSH 宿主
  刷新页面（或重启）后**由用户确认页签与席位。
- **0031 已实施并归档（ADR 0008 → implemented）**：两层文件、载荷双路径、面板对象/人物、
  `/api/persons` 三条、独立形态人物 CLI 均已接线；`node --test` 181、`python3 tests/run_tests.py`、
  `bash scripts/gate.sh` 全绿。**剩余用户自验**：①合成 live turn 看 agent 是否按
  `SKILL.md` 把旧四段工作本拆分（人物评价迁出、旧全文进 `.history.md`、`## 待归人物` 兜底）；
  ②真机群 + 私聊各跑一轮命中，确认载荷可读、档案落点正确；③钉钉 `senderId ≠ userId`
  的双 ID 记录/合并规则真机确认（本期待验证，不自动合并）。
- **0026–0029 已归档（随 0.12.0 / 0.13.0 发布）**：闲置重开与值守心跳、私聊关注程度
  （「只盯 @我」）、重开会话即开新会话、私聊里 @ 自己 = 对替身说话；四份 spec 与 plan 已
  `git mv` 进 `docs/specs/archive/` 并在 archive README 登记。真机项由用户自行验收
  （2026-11-04 用户指示直接归档，未在插件会话内实测；其余项均有测试/走查证据）。
- **市场收录待合并**：条目 PR
  [#11669](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11669)。唯一的红是
  「仓库满 1 天」自动检查（仓库 2026-11-02T15:59Z 建），该检查自己重跑，约 6 小时后达标；
  合并后市场当日构建即可搜到。自托管索引仍在，两者并存。
- **验证环境**：3080 使用 `IM_STANDIN_DIR=/tmp/im-standin-accept` 的隔离状态，只有合成会话
  `oc_e2e_local_only`；web profile 已 link 本地插件。**没有向真实客户外发**，也没有拉真实消息。
- **合成 live turn**：`chatWake` 创建 `session-76a20026…` → turn/end → `session_turns=1`、
  `last_ok=true`、post-turn `last_sync` 更新；会话元数据出现 `danger-full-access`，agent 直接
  写了 `profiles/feishu/oc_e2e_local_only.md`。无效 chat_id 的 CLI 报错是该演练的预期结果。
- **面板走查**：320 / 360 / 420，浅/深两套（spec 0032 后按五个页签重走一遍：无溢出、席位无角标）；`.ims-panel` 各宽度
  `scrollWidth === clientWidth`，越界元素 0；设置页三个数字框均 92px；详情「重开会话」
  在 DSH 会话行右侧不换行。走查截图在本地临时目录（未入库）。
- **状态文件**：真实 `~/.im-standin/state.json` 未被本轮写入；所有演练写入
  `/tmp/im-standin-accept/`（验收后已清理）。桌面 DSH 与 3080 不要同时写同一份 state。
- **钉钉真机已通，发送未验证**：组织开通「CLI 数据访问」后 `dws auth login --device` 一次成功
  （access 当日 18:09 到期 / refresh 2026-12-03），`profile list` 取到 `userId`，
  `env.json` 已写入 `self_id`。真实会话上监听命中、正文完整、水位推进、退出码 0。
  **发送只到 dry-run**：计划解析为 `send_personal_message` + `identity=user`，未真发。
  该组织里只有一个机器人会话，人类私聊的完整闭环仍缺真实对象。

## 挂账（按优先级）

1. **真实客户 live turn / 真实平台媒体**：0013 与 0017 的合成验证已做，但真实飞书/企微
   图片、文件、语音、视频尚未命中；等用户在场或指定测试会话时补，不要主动外发。
2. **历史待回清理**：旧库迁移带来的约 50 条 pending 是否在「设置 → 清理其他会话的待回」一次，待用户拍板。
3. **0.5.0 屏蔽的 UI 端到端截图**：功能已过测试，截图验证仍中断。
4. **钉钉真发与真人闭环**：插件已支持轮询 / 唤醒 / 发送，但真实发送仍只到 dry-run。
   真发前要定 `--ai-tag` 口径（默认给消息打 AI 标识）；再找一个真人会话跑完
   「命中 → 草稿 → 发送 → 重挂」。

## 下一步

1. **0040 真机（已完成）**：用户已验收；spec 0040 已归档，ADR 0012 已 implemented。
1. 用户重启/刷新 DSH 后验 spec 0036：设置页只剩「保温间隔」；把 `warm_min` 临时调成 1，
   观察约 1 分钟保温一次、约 2 分钟后下一条消息换新会话，再把 `warm_min` 改回 55。
   通过后 0036 已归档，无需再动。
2. 用户重启/刷新 DSH 后验 spec 0035：私聊命中只见一份人物档案、面板「人物」里每人一张卡
   （没有「私聊工作本」），旧私聊工作本下一轮被并入并归档；通过后把 0035 归档。
3. 用户重启/刷新 DSH 后验 spec 0032：页签只剩五个、席位没有红点、分身卡片「打开」能进
   会话详情；有问题按新 spec 修，通过后把 0032 归档。
4. 用户自查 spec 0031 的剩余真机项（已归档）：重启宿主后看面板「服务对象」群聊/人物两段、
   人物编辑/12KB/stale、私聊人物档案条、群本群人物；对一个旧画像会话跑一轮，让 agent 按
   `SKILL.md` 拆分（人物评价迁出、旧全文进 `.history.md`、`## 待归人物` 兜底）；再做一轮
   真机群/私聊命中确认载荷路径。钉钉双 ID 记录/合并在真人会话上确认。
5. 用户自行验收 0026–0029 的真机项（spec 已归档）：重启宿主后测「只盯 @我」普通消息不唤醒 /
   @ 唤醒、重开会话立刻有新会话、私聊里 @ 自己能被处理、闲置重开与心跳；临时调
   `warm_min` 的话记得改回 55。有问题按新 spec 修。
6. 等真实客户消息/媒体命中；只观察，不主动给真实客户发消息。
7. 用户确认后清理历史待回；清理前不要当作用户已同意。
8. 钉钉补完真人闭环：在环境里启用钉钉，给一个真人会话跑「命中 → 草稿 → 发送 → 重挂」，
   先定 `--ai-tag` 口径。

## 规则性提醒

- 改路由 / state 字段 / 配置键 → 同 commit 改 `docs/specs/contracts/`，否则测试红。
- 收尾跑 `bash scripts/gate.sh --quick`；发版跑全量。
- 版本号三处一致：`dsh-plugin/package.json`、`CHANGELOG.md` 顶部、git tag。
- 一个 DSH 宿主写 state；别同时开桌面 app 与 3080 值守同一批会话。
- 公开仓库不写真实消息、真实 ID、本机路径与凭据；演练只用合成夹具。
