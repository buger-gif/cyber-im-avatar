# 0017 值守可靠性：唤醒正确性与富媒体交付

> 状态: 已验收
> 编号: 0017
> 版本: 0.9.0
> 关联: `docs/specs/contracts/01-api.md`、`docs/specs/contracts/02-storage.md`、`docs/specs/contracts/03-config.md`、`docs/architecture/02-data.md`、`docs/architecture/03-runtime.md`、`docs/decisions/proposed/0006-media-handoff.md`

## 背景

2026-11-03 对 DSH 插件壳做了一次全盘审计。文本链路本身是通的：轮询、值守候选、
首轮 baseline、命中唤醒、live turn、`/cyber-im-avatar` 注入、post-turn 补拉、
画像回写都能对上；`node --test` 63 条、`tests/run_tests.py` 110 条、
`bash scripts/gate.sh --quick` 全绿。

但审计发现三类事实：

1. **唤醒正确性有洞。** 用假 adapter 复现：
   - `whoami` 失败时 `poller.cycle()` 仍继续拉取，`self_id` 为空把本人消息判成对方；
     post-turn 补拉会把 agent 自己发的消息再唤醒一次，可能自回环。
   - `process()` 的 batch 只认 `ts_epoch > last_epoch`。两条消息落在同一秒时，
     后一条 `pending=1` 但 `woke=false`，之后也不会自动唤醒。
   - `isMention()` 在 mentions 指向别人时仍用名字子串/正文兜底：本人“张三”，
     有人 @“张三丰”会被判成 @我。

2. **富媒体只到了字符串层。** 实测一个 50 条消息的飞书会话：42 text、5 sticker、
   2 image、1 post。`lark-cli` 把 image 格式化成 `[image: img_...]`、sticker 格式化成
   `[Sticker]`、post 压平成带内嵌图片引用的一行；插件原样存字符串，不下载、
   不把资源交给 agent。企微图片只留 `[图片]`，`media_id` 被丢弃；面板用
   `msgText()` 纯文本渲染；钉钉在插件 `ADAPTERS` 里没有实现。

3. **调度路径有意外和失效。** 点开会话 `fetch=1` 会走 `pollChat → maybeWake`；
   手动 `/api/poll` 用 `force:true` 绕过 20 秒冷却，点开在冷却跳过时又回退
   `fetchThread()` 直接打 CLI；“定时拉哪些私聊”控件写 `dm_scope` 但 `candidates()`
   根本不看它；`dm_recent` 允许 200，飞书 `--page-size` 实测上限 100；
   `/api/thread` 的 `limit` 允许 100，飞书 `--limit` 实测上限 50。

项目最终目标不变：**插件只当壳，skill 是脑子；有人发消息才叫醒 AI，等待期不跑模型；
消息只在本机；不新增监听端口和运行时第三方依赖；平台差异如实标注。**
图片不能只给一个 key 让会话自己取：插件已经在宿主里跑 CLI，就应该把适配的媒体取回来，
随唤醒载荷一起交给会话；只有确实没适配的类型，才在 prompt 里提示 agent 可以走 CLI。

## 目标与非目标

- 目标：
  - 值守只在真实新消息上唤醒：不把本人消息当对方、不因同秒漏消息、不因别人 @ 误唤醒。
  - 聊天正文里的 `/name` 不再自动触发 DSH 的 skill 手势；聊天内容仍然只当数据。
  - **富媒体由插件取回**：图片下载后作为 DSH 附件随唤醒消息交给会话（模型能直接看到）；
    文件/语音/视频下载到本地媒体目录并在 prompt 里给路径；post 的内嵌图片一起取。
  - **只有未适配类型才提示 agent 走 CLI**：卡片、合并转发、位置、名片、系统消息、
    未知类型，以及平台下载命令不可用/失败的消息，在 prompt 里明确标注“未适配，可用 CLI 试取”。
  - 点开/手动/定时三条路径的唤醒与冷却语义写清楚：点开只读，手动唤醒有独立入口。
  - 平台边界诚实：插件壳只支持飞书/企微；企微群可手动加入；钉钉仍是独立 skill 形态。
  - 配置上限与平台 CLI 上限对齐，不再出现“配置允许、CLI 拒绝”的死角。
- 非目标：
  - 不为钉钉实现插件 adapter；不把钉钉从 skill 平台矩阵里删掉。
  - 不在 `state.json` 存二进制；不新增 `/api/resource`；不做面板内嵌图片/文件预览。
  - 不每轮 poll 都下载媒体：只在**命中唤醒**时取本次载荷里的媒体，等待期仍然零成本。
  - 不新增端口、不新增运行时第三方依赖、不改 DSH 宿主路由。
  - 不改 10 分钟轮询下限、群默认不拉、屏蔽即不同步、画像四段/上限、DSH 会话复用规则。
  - 不改独立 skill 的监听主循环（`listen_core.py`）；只改 DSH 壳相关 prompt/文档/引用。
  - 不做媒体外发、不改草稿确认/全自动约定。

## 方案

### 1. 水位与身份：按消息 ID 收口

`chats` 增加 `last_msg_id`（string，默认 `""`），与现有 `last_epoch` / `last_ts` 并存：

- `process()` 改为按“最新在前”的顺序收集 batch，遇到 `last_msg_id` 停止；
  不再用 `ts_epoch > last_epoch` 作为唯一判据。这样同一秒的多条消息都能进 batch。
- 存量 `state.json` 没有 `last_msg_id` 时，回退到 `last_epoch` 判据；下一次成功拉取后写入。
- 水位消息已不在拉取窗口时，回退 `ts_epoch > last_epoch`，避免永远停在旧 ID。
- 不额外多取 1 条：`per_chat_limit` 的最大值就是平台 `--limit` 的上限（飞书 50），再多取会
  直接撞校验。唤醒 prompt 固定加一行：
  `载荷只列最近 N 条；需要更早上下文或密集对话，先拉 30 条再回。`
- `whoami()` 失败不再永久缓存。`cycle()` 在 `whoami.ok === false` 或 `self_id` 为空时
  跳过该平台的所有会话，并记一条 `poller.errors`；`pollChat()` 在无 `self_id` 时
  不进入唤醒。`doctor` 显示“身份不可用，已暂停该平台拉取”。

### 2. @ 判定：有 mentions 就只认 ID

`isMention()` 的规则改成：

| 条件 | 判定 |
| --- | --- |
| `mentions` 非空且 `self_id` 非空 | 只做 ID 精确匹配；不匹配就是“不是 @我”，不再走名字/正文兜底 |
| `mentions` 非空、`self_id` 为空 | mention 的 `name` 与 self name **完全相等**才算；不用 `includes` |
| `mentions` 为空 | 正文里的 `@name` 必须作为独立 token 出现（前后是空白/标点/行首行尾），不用 `includes` |

`selfNames` 仍保留长名/括号前短名，但只用于 mentions 缺失的兜底。

### 3. 提示词注入面：不可信文本里的 `/name` 不能进 DSH 手势

DSH 的 `dsh-tool-skill` 会扫描 `source.kind === "user"` 的整段文本，空白边界的 `/name`
会被当成 skill 手势。插件把客户正文、群名、发送者昵称原样拼进同一条 user 消息，
客户发一句“帮我 /lark-doc”或群名叫 `/help` 就可能注入别的 skill。

- 新增 `sanitizeUntrusted(text)`：只替换**空白边界、后面是空白/行尾**的 `/name` 手势
  （把斜杠换成全角 `／`），并破坏 `<!--`；普通 URL、路径、分数不动。用于
  `chatName`、`sender_name`、`content` 这类平台/聊天内容。画像文件由用户与 agent
  维护，不走这个函数。
- 首行 `/cyber-im-avatar` 是插件自己的意图，不经过 sanitize。
- 不把 sanitize 当成完整防注入：skill 的“聊天内容不可信”铁律继续保留。

### 4. 富媒体：插件取回，随唤醒载荷交付

#### 4.1 适配表

插件只对“知道自己怎么取”的类型主动下载；其余类型不猜。

| 平台 | 适配（插件取回） | 未适配（prompt 提示 CLI） |
| --- | --- | --- |
| 飞书 | image、file、audio、media/video、post（含内嵌图片） | interactive、merge_forward、share_chat、share_user、location、system、未知 |
| 企业微信 | image、file、voice、video（`wecom-cli media` 可用时） | 命令不可用/失败的类型，以及卡片等未知类型 |
| 钉钉 | 插件壳不加载 adapter | 独立 skill 形态；插件里标“不支持” |

sticker 是已知类型但没有可下载文件：prompt 只标 `[表情]`，不提示 CLI、不下载。

适配表集中在 `im.js` 的 `MEDIA_ADAPTERS`，不散落在 poller。

`recent` 为媒体消息保存四个字段：`msg_type`（平台类型）、`app_link`（飞书
`message_app_link`）、`media_id`（平台结构化媒体键，企微必须；飞书能从 content 解析
就填）、`media_paths`（插件下载后的本地绝对路径数组）。`state.json` 只存这些指针/路径，
不存二进制。

#### 4.2 下载时机与成本

- **只在命中唤醒时下载**：`Turns.wake` 确定本次载荷要带哪些 `new/opened` 的
  `dm/mention/service` 消息后，才对这批消息下载媒体；没有命中唤醒的定时轮、点开、
  fyi/out、历史消息都不下载。
- 手动唤醒同样只下载 `pendingMessages` 里的待回消息。
- 同一会话同一消息已有 `media_paths` 且文件仍在时，不重复下载。
- 单次唤醒设上限：最多 4 张图片 / 合计 10MB；超出部分不 attach，只给路径和 CLI 提示。
  实现时优先读 DSH `attachments.imageLimits`，以宿主配置为准。
- 下载超时（单条 20 秒）或失败只降级，不阻断 turn；prompt 里标“下载失败，可用 CLI 取”。

#### 4.3 下载与落盘

`IM.downloadMedia(platform, chat_id, message)` 返回
`{ ok, files: [{ path, kind, name }], error }`：

- 飞书：
  - 从 `content` 解析资源：`[image: img_...]`、`[file: name]` + `file_key`、
    post 里的内嵌图片引用（`img_...`）；解析不到就用
    `+messages-mget --message-ids <om_...> --download-resources` 只取这一条。
  - 单资源用
    `lark-cli im +messages-resources-download --message-id <om_...> --file-key <key> --type image|file --output <相对/绝对路径>`。
  - CLI 的 `--output` 只允许 cwd、`/tmp`、`~/files`；插件把子进程 cwd 设到媒体目录，
    或先落 `/tmp` 再 move 到媒体目录，不把任意绝对路径直接传给 `--output`。
  - sticker 不下载；标“表情”即可。
- 企业微信：`media_id` 走 `wecom-cli media`；实现时以 `--help` 校准参数。命令不可用
  或下载失败时按“未适配”处理，prompt 明确说“壳内取不到，可转人工/让用户描述”。
- 落盘路径：`~/.im-standin/media/<platform>/<safe_chat_id>/<safe_msg_id>/<safe_name>`；
  目录 700、文件 600；文件名只保留 basename，拒绝 `..` 与绝对路径。
- 清理：启动时和每日一次删除 7 天前的媒体；单会话上限 200MB，超出从最旧删。
  清理后把 `recent.media_paths` 里已不存在的路径去掉，避免 prompt 指向空文件。
- `state.json` 只存字段与路径，不存 base64/二进制；媒体目录与画像目录同级，便于整体删除。

#### 4.4 交付给 DSH 会话

- `Turns` 通过宿主 `ctx.inject(["attachments"], ...)` 拿 `attachments` 服务；
  图片下载后用
  `attachments.admitPromptContent([{ type: "image", mediaType, data, name }])`
  转成 durable `image` block，和文本一起放进现有 `makeUserMessage` 的 `content`。
- `makeUserMessage` 改成异步：先取文本块，再按媒体列表 admit 图片，最后
  `agent.followup(message)`；`source` 仍是 `{ kind: "user" }`，保证 `/cyber-im-avatar`
  手势仍会被 DSH 识别。
- 图片格式只接受 DSH 支持的 png/jpeg/webp/gif；其他格式按“已下载但不可 attach”处理。
- attach 前检查模型是否支持图片输入（`ctx.get("llm").resolveModelInfo(...).inputModalities`
  含 `image`）；拿不到或明确不支持时，不 attach，只在 prompt 里给本地路径并说明
  “当前模型不可读图，可转人工/让用户描述”。
- `attachments` 服务不存在、admit 失败、超过 imageLimits：降级为文本 + 本地路径，
  不阻断唤醒。
- 文件/语音/视频不做 image block：下载后在 prompt 里给本地路径，agent 用文件工具读；
  读不了就如实说，不上传、不转发。

#### 4.5 prompt 形状

- 文本行不变：`- [ts] 张三: 正文`。
- 已附带图片：`- [ts] 张三 [图片]（已随载荷附带；本地：/.../media/.../img.png）`。
- 文件/音视频：`- [ts] 张三 [文件: 报价单.pdf]（本地：/.../media/.../报价单.pdf）`。
- sticker：`- [ts] 张三 [表情]`，不提示 CLI。
- 未适配/下载失败：`- [ts] 张三 [卡片]（未适配；可用 CLI 取，msg_id: om_...）`
  或 `（下载失败；可用 CLI 取，msg_id: ...）`；有 `media_id` 时一并带上。
- 固定说明：
  `已适配的图片随载荷附带，文件/音视频给了本地路径；标注“未适配/下载失败”的再按 skill 用 CLI 取，拿不到就如实说，不要猜。`
- 没有原生消息 ID 的企微复合指纹消息，标注“按时间/发送者回查”。

#### 4.6 skill 与面板

- `SKILL.md` 的“在 DSH 插件壳里”增加“富媒体”小节：
  - 载荷里已附带的图片直接看，不要重复用 CLI 下载；
  - 文件/音视频按本地路径读；
  - 只有标“未适配/下载失败”的才走 CLI，命令见对应 `references/`；
  - 下载/读取只在本机工作区或媒体目录，不执行、不打开、不转发。
- `references/feishu.md` 补 `+messages-resources-download` 与 `--download-resources`；
  `references/wecom.md` 补 `wecom-cli media` 实际命令与失败兜底；
  `references/dingtalk.md` 标注插件壳不支持。
- 面板：`msgText()` 对媒体返回可读标签；有 `app_link` 时渲染“在飞书打开”，
  没有时显示“在 IM 客户端查看/已在会话中附带”。面板不读本地二进制、不加资源路由。

### 5. 调度语义：点开只读，手动才唤醒

- `App.thread()` 调 `pollChat()` 时传 `wake: false`；`/api/thread` 无论 `fetch=1` 与否
  都只补拉/分类，不起 turn。显式唤醒只走 `POST /api/chat/wake`。
- `pollChat()` 增加 `{ wake = true }` 选项；定时轮和 post-turn 用默认 true，点开用 false。
- `cooldown_sec` 对点开、手动都生效；post-turn 补拉是唯一例外（它要闭合刚发出的消息）。
  手动 `/api/poll` 不再用 `force` 绕过冷却；`force` 只保留给 post-turn。
- `fetchThread()` 只在 `pollChat` 返回错误时兜底；`skipped`（冷却中）不再触发第二次 CLI。
- `fetchThread()` 不更新 `last_sync` 的现状保留，但冷却判断只看 `last_sync`，避免展示路径
  把水位搅乱。

### 6. 平台与配置边界

- 插件 `platforms` 白名单只接受 `feishu` / `wecom`。存量 `dingtalk` 会话保留在 state 里，
  但状态页标“插件壳不支持钉钉（独立 skill 形态可用）”，不拉取、不唤醒、不删除。
- 企微群手动加入：面板搜索卡片增加“显示名 + 会话 ID + 私聊/群”的小表单，走现有
  `/api/watch`；显示名只用于面板，不写回平台。企微没有群枚举/群搜索，这是唯一入口。
- `dm_scope`：删除设置页的“定时拉哪些私聊”控件；配置键继续被 `normalizeConfig()` 接受，
  但标记为 legacy no-op（契约 03 说明），候选规则仍是“只看 `watching` 私聊”。
- `dm_recent`：`refreshChatlist()` 传给飞书的 `--page-size` 夹到 100；配置仍允许 200，
  超出部分由前台筛选，不再让 CLI 校验失败。
- `fetchThread()` 的 `limit` 夹到 50（飞书 CLI 上限），企微在客户端侧截到 `limit`。
- `per_chat_limit`：飞书走原生 `--limit`；企微 CLI 只有时间窗，拿到后在客户端侧按
  最新 N 条截断；契约 03 写清平台差异。
- `backfill_hours` 接上消费者：企微 `fetchThread()` 的回看窗口用它（上限 7 天）；
  飞书没有时间回看参数，保持不传。
- `service` 消息类型没有生产者：收件箱删除“客服”筛选；存量 `service` 记录继续按
  `dm/mention` 兼容读取，不迁移、不删数据。
- `ensureSkill()` 的 marker 增加 `content_hash`；版本号相同但 skill 内容变了也重装，
  仍只覆盖带 marker 的受管副本。

### 7. 契约与文档同步

- 契约 01：`/api/thread` 写明“只读，不唤醒”；`/api/poll` 写明“受 `cooldown_sec` 约束，
  post-turn 例外”。
- 契约 02：`chats.last_msg_id`；`recent.msg_type` / `app_link` / `media_id` /
  `media_paths`；迁移默认值。
- 契约 03：`dm_scope` 标 legacy no-op；`backfill_hours` / `per_chat_limit` 写平台差异；
  `cooldown_sec` 写点开/手动都生效。
- 架构 02/03：数据形状、三条拉取路径、唤醒语义、媒体下载与交付。
- `dsh-plugin/README.md`、`README.md`、`SKILL.md`、`references/*.md`：用户可见行为与平台边界。
- `CHANGELOG.md`：发版时写；本 spec 实施阶段不改版本号。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 只把媒体 key 放进 prompt，让 DSH 会话自己用 CLI 取 | 模型看不到图片，等于把“取资源”的工作和失败面丢给 agent；用户明确否掉 |
| 插件下载后只给本地路径、不 attach | 模型仍然看不到图；图片应作为 DSH image block 随消息交付 |
| 每轮 poll 都下载媒体 | 没人发消息时也打下载接口，违背“等待期零成本”；只在唤醒时取本批 |
| 把二进制存 `state.json` 或新开 `/api/resource` | 指针状态变成媒体库，增加存储/清理/鉴权面；见 `docs/decisions/proposed/0006-media-handoff.md` |
| 面板内嵌预览 | 浏览器拿不到本地文件，做预览必须新增资源路由；本 spec 只给“在 IM 打开” |
| 给钉钉补插件 adapter | 平台差异大、没有实测授权链路；先如实标注，独立 skill 继续支持 |
| 手动/点开继续绕过冷却 | 面板连点会直接打 IM 接口；冷却本来就是为这个场景写的 |
| 未适配类型也静默忽略 | 客户发卡片/合并转发时 agent 至少应该知道“取不到”，并能尝试 CLI |

## 影响面

- 代码：`dsh-plugin/lib/im.js`、`poller.js`、`state.js`、`turns.js`、`app.js`、
  `lib/index.js`（注入 `attachments` / `llm`）、`web/panel.js`、`lib/client.js`、
  `skill-install.js`；新增媒体落盘/清理辅助模块（可放 `lib/media.js`）。
- 契约：`docs/specs/contracts/01-api.md`、`02-storage.md`、`03-config.md` 同 commit 改。
- skill / references：`SKILL.md`、`references/feishu.md`、`references/wecom.md`、
  `references/dingtalk.md`、`references/troubleshooting.md`。
- 文档：`docs/architecture/02-data.md`、`03-runtime.md`、`dsh-plugin/README.md`、
  `README.md`；发版时 `CHANGELOG.md`。
- 用户可见：点开不再隐式回复；图片随唤醒消息出现，文件/音视频给本地路径；
  未适配类型标“可用 CLI 取”；企微群可手动加入；钉钉在插件壳里明确不可用；
  `dm_scope` 控件消失。
- 兼容：老 `state.json` 缺字段按默认值；老 `dm_scope` 配置继续可读但无行为；
  存量 `dingtalk` 会话保留不删；手装 skill 目录（无 marker）仍不覆盖；老 DSH 没有
  `attachments` 服务时自动降级为文本+路径。

## 验收

- [x] `whoami` 失败 + 本人消息 → 不唤醒、记错误、`doctor` 显示该平台暂停；恢复授权后下一轮恢复。
- [x] 两条消息同为 epoch 1000 → 首轮 baseline 后，第二条进入 batch 并只唤醒一次。
- [x] 唤醒 prompt 固定含“本次只追加 N 条新消息，更早上下文按 skill 在线拉”的提示。
- [x] 本人“张三”，mentions 指向“张三丰” → 不唤醒；mentions 精确指向本人 → 唤醒。
- [x] prompt 里客户正文含 ` /lark-doc`、`<!--` → 不出现可触发的 `/lark-doc` 手势，`<!--` 被转义；首行 `/cyber-im-avatar` 仍在。
- [x] 飞书 image 消息 → 插件下载到媒体目录；唤醒 user message 的 `content` 含一个 `image` block；文本行标“已随载荷附带”并给本地路径；不要求 agent 再调 CLI。
- [x] 飞书 post 含 2 张内嵌图 → 两张都下载并按 DSH imageLimits attach；超出上限时只 attach 允许的张数，其余给路径/CLI 提示。
- [x] 飞书 file/audio/video → 下载到 `~/.im-standin/media/...`，prompt 给本地路径；`state.json` 只有 `media_paths`，没有二进制。
- [x] 飞书 sticker → 不下载、不提示 CLI，prompt 只标 `[表情]`。
- [x] 飞书 interactive/merge_forward/location/share_chat/system → 不下载，prompt 标“未适配，可用 CLI 取，msg_id: ...”并带 `msg_id`。
- [x] 企微 image/file/voice → `wecom-cli media` 可用时下载；不可用时 prompt 明确“壳内取不到，可转人工/让用户描述”。
- [x] 媒体下载失败/超时 → turn 照常启动，prompt 标“下载失败，可用 CLI 取”，不阻断回复。
- [x] 模型不支持图片输入 → 不 attach，prompt 给本地路径并说明“当前模型不可读图”。
- [x] 定时轮/点开/fyi/out 不触发媒体下载；只有命中唤醒的待回消息才下载。
- [x] 媒体目录 700/文件 600；7 天前文件被清理；`recent.media_paths` 里失效路径被移除。
- [x] `/api/thread?fetch=1` 有待回消息 → 不调用 `wake`；`POST /api/chat/wake` → 调用一次 `wake`。
- [x] 20 秒内连续两次手动 `/api/poll` → 第二次 `skipped`；post-turn 补拉仍执行。
- [x] `dm_recent=200` → 飞书 `--page-size` 实际为 100；`/api/thread?limit=100` → 飞书 `--limit` 实际为 50。
- [x] 企微群用“显示名 + chat_id”加入 → 进入值守列表，`pollChat` 用该 chat_id；面板不露未填的 imid。
- [x] `platforms=["dingtalk"]` → 插件拒绝/忽略并给出明确提示；存量钉钉会话不被删除。
- [x] 设置页不再出现“定时拉哪些私聊”；`dm_scope` 老配置仍能加载。
- [x] 收件箱不再有“客服”筛选；存量 `service` 记录仍能显示。
- [x] `ensureSkill()` 在版本号相同、`SKILL.md` 内容变化时重装受管副本。
- [x] `node --test`、`python3 -I tests/run_tests.py`、`bash scripts/gate.sh --quick` 全绿。


> 验收记录（2026-11-03）：1–5、12–24 由 `node --test` 101 条用例与代码走查逐条覆盖
> （whoami 暂停/恢复、同 epoch 两条只唤醒一次、prompt 只追加 N 条、@张三 vs 张三丰、
> `/lark-doc` / `<!--` 转义、媒体降级、冷却、钉钉存量、配置夹取、skill 内容变更重装）。
> 6–11 的下载/附件/媒体清理由 `tests/im.test.mjs`、`tests/media.test.mjs`、
> `tests/turns.test.mjs` 的夹具与假 CLI 覆盖；**真实飞书/企微媒体消息待命中**
> （本轮无真实客户消息，合成会话 `oc_e2e_local_only` 没有媒体，未假装验过）。
> `python3 -I tests/run_tests.py`：109 通过 / 1 失败（失败项为 verify_docs 的状态词格式，
> 已修复并复跑通过）；`bash scripts/gate.sh --quick` 五项全绿。

## 风险与回滚

- 风险：按 `last_msg_id` 收口时，水位消息掉出拉取窗口会退化为 epoch 判据，极端情况下
  可能重放一条旧消息；用 `recent` 的 `msg_id` 去重和 turn 去重兜底。
- 风险：`whoami` 瞬时失败会让该平台暂停一轮，可能晚 10 分钟才恢复；失败不永久缓存，
  每轮重试，`doctor` 可见。
- 风险：唤醒时下载媒体会增加 turn 启动延迟；单条 20 秒超时、单批 10MB 上限、
  失败降级，不能阻断回复。
- 风险：媒体目录持续增长；7 天 / 200MB 清理与 `media_paths` 回写要一起做，避免
  prompt 指向已删除文件。
- 风险：DSH `attachments` / `llm` 服务在旧版本不存在；全部按“文本+本地路径”降级，
  不把插件启动绑死在附件服务上。
- 风险：企微媒体命令参数漂移；以 `--help` 校准，失败按未适配处理，不猜。
- 风险：点开不再唤醒会让依赖“点开即处理”的用户不习惯；文案明确“现在处理”，
  需要时可加回 `wake=1` 查询参数（本 spec 不做）。
- 回滚：按 phase 回退单个 commit；`last_msg_id` 可留可删（缺省回退 epoch）；
  媒体字段/目录可留空；`attachments` 注入可撤；钉钉 state 不动。
