# PROGRESS — 当前断点

> **新会话第一读取点。** 这份文件只回答三个问题：现在到哪了、什么被挂起了、下一步动哪里。
> 写法见 `docs/AGENTS.md`：活文档，就地改写，不做历史（历史在 `docs/implementation/log/`）。

## 更新时间

2026-11-13（0.21.0 已发布：启动值守回执 0048 待真机、自检分诊 0047 已验收归档；0046 自 @ 关键词启动值班待真机；手动停盯后旧 @ 不再重新分诊；0045 已归档；0044 / 0043 / 0042 / 0040 / 0039 / 0038 待真机）

## 最近批次

| 日期 | 主题 | 证据 |
| --- | --- | --- |
| 2026-11-13 | 0.21.0 发布（0048 启动回执 + 0047 自检分诊）：全量 gate 全绿；CI Trusted Publishing 发布成功并带 provenance，`v0.21.0` tag；npm latest / tarball / 市场索引都指向 0.21.0；npm 包描述与市场索引描述同步「自 @ 开值班 + 可配回执」 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、`dsh-plugin/scripts/make-market-index.mjs`、[run 43394316608](https://github.com/buger-gif/cyber-im-avatar/actions/runs/43394316608) |
| 2026-11-13 | 启动值守回执（0048）：`command.reply_enabled` / `reply_text`（默认开，默认「支持用户自定义，默认就是 24 小时值班，上线 @ 我即可触发。」）；只在 `result=started` 时由插件直接发一条纯文本，群聊 / 私聊都发，`already / blocked / failed` 不发；失败只记 `chats[].command.reply`、不回滚值班；设置页可改可关、会话详情看结果；契约 01/02/03、架构 02/03、README、SKILL、插件 README 同步；Node 300 绿、gate quick 绿；待真机 | `dsh-plugin/lib/{command,state,poller,app}.js`、`dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、`dsh-plugin/tests/`、`docs/specs/active/0048-启动值守回执.md` |
| 2026-11-13 | 自检分诊（0047）：拉取与通路自检对 `network` 类失败重试一次；CLI 错误归一为一行中文（网络 / 授权 / 权限 / 字段漂移 / 接口报错）并给 ID 打码，原文进宿主日志；`cli doctor` 的 warn 不再阻塞、全平台体检只查启用平台；3 秒自检窗口内全部拉取失败按失败退出，不再被超时掩盖；skill 213 绿、Node 293 绿 | `dsh-plugin/lib/{im,poller}.js`、`scripts/{bootstrap,doctor,listen_core,data_guard}.py`、`tests/run_tests.py`、`dsh-plugin/tests/`、`docs/specs/archive/0047-自检分诊.md` |
| 2026-11-13 | 0.20.0 发布（0046 自 @ 启动指令 + 手动停盯不再复检旧 @）：全量 gate 全绿；CI Trusted Publishing 发布成功并带 provenance，`v0.20.0` tag；npm latest / tarball / 市场索引都指向 0.20.0；版本自检 3 分钟判红（registry 3 分 8 秒才可见），重跑后绿，窗口已放宽到 5 分钟 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、`docs/implementation/runbooks/publish.md`、[run 43360663970](https://github.com/buger-gif/cyber-im-avatar/actions/runs/43360663970) |
| 2026-11-13 | 手动停盯后旧 @ 不再重新分诊：`recordUserDuty(..., "ignore")` 把 `duty.sweep_epoch` 推到停盯时刻、清 `event_id` 并删未应用决策文件；sweep 另按 `by=user` + `decided_at` 兜老 state；Node 287 绿、gate 全量绿 | `dsh-plugin/lib/{app,poller}.js`、`dsh-plugin/tests/{app,poller}.test.mjs` |
| 2026-11-12 | 自 @ 关键词启动值班（0046）：`config.command.enabled/start_keyword`；已值守会话快车道即时识别，未值守飞书会话每分钟一条 `+messages-search`（本人发送 + @本人，只取一页）发现；同一 `platform:chat_id` 只允许一个值班（已有会话 / 正在启动 → `already`）；命中关键词的 `cmd` 被开关消费，开场载荷说明不要回复；面板设置卡 + 会话详情结果；ADR 0015；契约 01/02/03、架构 02/03、README、SKILL、references 同步；Node 全绿、gate 全量绿；待真机 | `dsh-plugin/lib/{command,im,poller,turns,state,app}.js`、`dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、`dsh-plugin/tests/`、`docs/specs/active/0046-自at关键词启动值班.md` |
| 2026-11-12 | 0.19.0 发布（0043 / 0044 / 0045）：三条未发布特性进版；npm 包描述与市场索引描述同步当前形态（值守私聊 / 群聊、@ 或新消息唤醒、关注程度三态、新群自动分诊、值班单点草稿 / 全自动、消息只留本机）；CI Trusted Publishing 成功，`v0.19.0` tag；npm latest 与市场索引指向 0.19.0 | `CHANGELOG.md`、`dsh-plugin/package.json`、`dsh-plugin/market/index.json`、[run 43186222163](https://github.com/buger-gif/cyber-im-avatar/actions/runs/43186222163) |
| 2026-11-12 | 载荷只声明变化（0045）：发送方式 / 关注程度 / 本人指令规则只在首轮与切档 / 压缩后的第一轮声明；`Turns` 按 DSH 会话内存记账（followup 成功才记、`compaction/*` 后清空口径与人物档案指针），skill 补常驻口径；ADR 0014；用户真机确认，Node 265 绿、gate quick 绿；已验收归档 | `dsh-plugin/lib/turns.js`、`dsh-plugin/tests/turns.test.mjs`、`SKILL.md`、`docs/architecture/03-runtime.md`、`docs/specs/archive/0045-载荷只声明变化.md` |
| 2026-11-12 | 分诊值班跟随加入工作区（0044）：新增 `config.join_workspace` 持久化面板「加入值守时绑定工作区」；自动分诊判定 watch / trial 后首个值班会话按「配置 → 最近在用 → DSH 默认」落 `chats[].workspace`（已有绑定不覆盖）；面板同序并同步配置；契约 03、README、CHANGELOG、测试同步；Node 全绿、文档对账、gate quick 全绿 | `dsh-plugin/lib/{state,workspaces,duty,app}.js`、`dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.js`、`dsh-plugin/tests/`、`docs/specs/active/0044-分诊值班跟随加入工作区.md` |
| 2026-11-10 | 启动竞态止损（0042）并发布 0.18.3：`dsh.client.immediately` + 宿主入口只静态依赖 Node 内置（导入 ~12ms→~4ms）；npm latest 与市场索引指向 0.18.3；诊断与 DSH 上游补丁草稿见 `docs/audits/2026-11-10-web-boot-audit-race.md` | `dsh-plugin/package.json`、`dsh-plugin/lib/index.js`、`dsh-plugin/market/index.json`、[run 42794468238](https://github.com/buger-gif/cyber-im-avatar/actions/runs/42794468238) |
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

- **0048 启动值守回执已实施，待真机验收**：设置页「IM 启动指令」新增回执开关与文案
  （`command.reply_enabled` / `reply_text`，默认开、默认句可改可清空）；只在真正拉起新值班
  （`started`）时由插件直接发一条纯文本，群聊 / 私聊都发，已有值班 / 屏蔽 / 失败都不发；
  发送失败只写 `chats[].command.reply`，不影响值班。`node --test` 300 绿、`gate --quick`
  全绿。**剩余用户自验**：找没值守的飞书群 @ 自己 + 「启动」，群里出现该句、面板显示
  「已发」；已有值班再发不重复；把文案清空后启动只开值班不发消息。真机通过后归档 0048。
- **0046 自 @ 关键词启动值班已实施，待真机验收**：设置页「IM 启动指令」可改关键词 / 关闭；
  已值守会话即时识别，未值守飞书会话每分钟搜索；同一会话已有值班只记 `already`，
  不新建。`node --test` 285 绿、`gate` 全量绿。**剩余用户自验**：在未值守的飞书私聊 /
  群里 @ 自己 + 「启动」，约 1 分钟内面板出现值班；重复发只显示冲突；关掉指令后自 @ 回到
  普通唤醒。真机通过后归档 0046。
- **0044 分诊值班跟随加入工作区已实施，待真机验收**：新增 `config.join_workspace`；
  自动分诊判定 watch / trial 后，首个值班会话按「配置 → 最近在用 → DSH 默认」落
  `chats[].workspace`，已有绑定不覆盖；面板「加入值守时绑定工作区」同步配置。
  `node --test`、`gate --quick` 全绿。**剩余用户自验**：改一次加入默认 → 刷新面板仍显示；
  等自动分诊拉起一个新值班，确认卡片工作区与会话 cwd 一致。真机通过后归档 0044。
- **0043 发送方式已实施，待真机验收**：每个值守会话有独立 `send_mode`（草稿 / 全自动），
  「分身」卡片与会话详情各自可切；设置页只配「新建值守默认」`send_mode_default`，新值班首次
  加入时固化，之后改默认不覆盖已有值班。每次唤醒 / 开场按该值班声明发送方式；心跳与值守台
  不注入。存量已值守会话按旧全局值/默认值补显式值，未值守留空；未发布旧键 `send_mode`
  自动迁成 `send_mode_default`。`node --test`、`python3 tests/run_tests.py`、`gate --quick`
  全绿。**剩余用户自验**：刷新右侧栏，①把一个值班切全自动，新消息命中后不询问直接发；
  ②再切回草稿审批，确认恢复留草稿；③改「新建默认」后加一个新值班，确认取新默认、
  旧值班不被覆盖。真机通过后归档 0043。
- **0042 已随 0.18.3 发布，待真机**：重启桌面 app 后看
  `~/Library/Logs/DeepSeek Harness/` 有没有新的 `crash-*-web-boot.log`，没有即通过。
- **0040 值守分诊已实施，待真机/全量 gate**：新群/被 @ 后由 agent 判断 watch / trial / ignore；
  插件只做发现、探针、排队、校验与执行。新群一律只盯 @我，群成员 >10 或未知只能 ignore；
  值守台每次新建会话，`sweep_min` 只看基线后未值守的新群。真机未做。
- **0039 已实施，待真机验收**：群里本人 @ 自己与私聊同权，记 `kind=cmd` 进批次唤醒；不算待回，
  全量群不等合并窗口。**剩余用户自验**：重启宿主后在在盯的群发 `@自己 …`，面板出现「处理中」，
  群里没有自动发言。
- **0038 已实施，待真机验收**：真实唤醒会打断绑定会话里任何在飞 turn；被手动 steer 的载荷按
  当前轮收口；turn 事件写 `~/.im-standin/logs/turns.jsonl`，体检页可看。**剩余用户自验**：手动
  发一条长任务再从群里 @，确认旧轮被打断、新载荷立刻起轮。
- **市场收录待合并**：条目 PR
  [#11669](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11669)。
- **验证环境**：3080 用 `IM_STANDIN_DIR=/tmp/im-standin-accept` 隔离状态；没有向真实客户外发。
- 更早的 0031 / 0032 / 0035 / 0036 / 0037 已归档或随版本发布，真机项由用户自行验收；
  历史见 `docs/specs/archive/README.md` 与 `docs/implementation/log/`。

## 挂账（按优先级）

1. **真实客户 live turn / 真实平台媒体**：0013 与 0017 的合成验证已做，但真实飞书/企微
   图片、文件、语音、视频尚未命中；等用户在场或指定测试会话时补，不要主动外发。
2. **历史待回清理**：旧库迁移带来的约 50 条 pending 是否在「设置 → 清理其他会话的待回」一次，待用户拍板。
3. **0.5.0 屏蔽的 UI 端到端截图**：功能已过测试，截图验证仍中断。
4. **钉钉真发与真人闭环**：插件已支持轮询 / 唤醒 / 发送，但真实发送仍只到 dry-run。
   真发前要定 `--ai-tag` 口径（默认给消息打 AI 标识）；再找一个真人会话跑完
   「命中 → 草稿 → 发送 → 重挂」。

## 下一步

1. 真机验 0048（没值守的飞书群 @ 自己 + 「启动」→ 群里出现回执、面板显示「已发」；
   已有值班再发不重复；清空文案后只开值班不发消息），通过后归档。
2. 真机验 0046（未值守飞书私聊 / 群 @ 自己 + 「启动」→ 约 1 分钟内有值班；重复发只冲突；
   关指令后回到普通 cmd），通过后归档。
3. 真机验 0044（改加入默认 → 刷新仍显示；自动分诊拉起的新值班落在该工作区），通过后归档。
4. 真机验 0043（单点开关 + 新建默认 + 自动模式载荷），通过后归档。
5. 重启桌面 app 验 0042 冷启动审计；通过后归档。
6. 0040 / 0039 / 0038 的真机项按上面断点逐条走；通过后归档。
7. 等真实客户消息 / 媒体命中；只观察，不主动给真实客户发消息。
8. 用户确认后清理历史待回；清理前不要当作用户已同意。
8. 钉钉补完真人闭环：启用钉钉，跑「命中 → 草稿 → 发送 → 重挂」，先定 `--ai-tag` 口径。

## 规则性提醒

- 改路由 / state 字段 / 配置键 → 同 commit 改 `docs/specs/contracts/`，否则测试红。
- 收尾跑 `bash scripts/gate.sh --quick`；发版跑全量。
- 版本号三处一致：`dsh-plugin/package.json`、`CHANGELOG.md` 顶部、git tag。
- 一个 DSH 宿主写 state；别同时开桌面 app 与 3080 值守同一批会话。
- 公开仓库不写真实消息、真实 ID、本机路径与凭据；演练只用合成夹具。
