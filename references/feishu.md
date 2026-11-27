# 飞书平台指南（lark-cli）

> 出问题先看 [troubleshooting.md](troubleshooting.md)（分诊表 + §A 版本漂移 / §B 授权到期 / §C 字段漂移），
> 或直接 `python3 scripts/doctor.py feishu`。

> 本 skill 里实测最完整的一条线：命令、字段、翻页、搜人都是真跑过的。

## 可见性边界

- 本工具以**本人身份**（`--as user`）轮询会话历史，因此本人可见的会话都能值守：
  个人↔个人私聊、bot 不在群里的群。
- bot 事件流（event consume）永远看不到 user↔user 私聊 —— 这就是默认用 poll 而不是 event 的原因。

## 关键命令（已实测）

| 动作 | 命令 |
|---|---|
| 登录态 / 本人 ID | `lark-cli auth status` → `identities.user.openId` |
| **按名字找人** | `lark-cli contact +search-user --as user --query "张三"` → 直接给 `open_id` + `p2p_chat_id` |
| 按群名搜群 | `lark-cli im +chat-search --as user --query "关键词"` |
| 最近会话 | `lark-cli im +feed-shortcut-list --as user`（几十条，最省） |
| 全量会话 | `lark-cli im +chat-list --as user --types=p2p,group --page-all --page-limit N` |
| 拉会话历史 | `lark-cli im +chat-messages-list --chat-id oc_xxx --order desc --limit 10 --as user` |
| 按人拉历史 | `lark-cli im +chat-messages-list --user-id ou_xxx --order desc --limit 10 --as user` |
| 批量补正文 | `lark-cli im +messages-mget --message-ids om_aaa,om_bbb --as user` |
| 下载图片/文件 | `lark-cli im +messages-resources-download --message-id om_xxx --file-key img_xxx --type image` |
| 一次取回附图 | `lark-cli im +messages-mget --message-ids om_xxx --download-resources --as user` |
| 回复 | `lark-cli im +messages-send --chat-id oc_xxx --msg-type text --as user --text "..."` |
| 表情回执 | `lark-cli im reactions create --params '{"message_id":"om_xxx"}' --data '{"reaction_type":{"emoji_type":"Get"}}' --as user` |

## 表情回执

- 表情是**点击**，不产生新消息；`emoji_type` 用官方枚举（区分大小写），「收到 / get」那个叫
  `Get`，常用还有 `OK`、`DONE`、`THUMBSUP`。
- user / bot 身份都能点，但调用者必须在消息所在会话里；删除只能删自己点的。
- 需要 `im:message.reactions:write_only` 授权。缺权限时命令非 0 退出，消息本身不受影响；
  重登一次 `lark-cli auth login` 会按当前命令重新要权限。

## 编辑 / 撤回本人消息

- **用户身份不能编辑文本**：`+messages-edit` 的 `--as` 只接受 `bot`；`--as user` 在参数
  校验阶段就拒。用 `lark-cli api PUT /open-apis/im/v1/messages/<id> --as user` 实测返回
  `230027`（缺权限 / 用户授权 / 租户策略）；官方文档的 Authorization 也只列
  `tenant_access_token`。
- `lark-cli im messages patch` 支持 `--as user`，但只接受 `interactive` 卡片；对文本消息
  返回 `230001 This message is NOT a card`。
- 飞书客户端里的“编辑”是客户端内部能力，不在 OpenAPI / lark-cli 的用户 token 通路上；
  要复用它就得代管 web 登录态，超出本项目「只复用 CLI 登录态」的边界。
- 唯一能用用户 token 原地更新的是**本人发出的 interactive 卡片**：
  `+messages-send --as user --msg-type interactive` → `im messages patch --as user`；
  要求发送 / 更新身份一致、卡片 `config.update_multi=true`、14 天内、单条 5 QPS。
  实测：本人账号发卡成功（`sender_type=user`、`is_agent=false`），随后 patch 成功，
  卡片内容原地更新；不是应用号消息。
- 撤回重发（`im messages delete --as user` + `+messages-send`）不是编辑：对方会看到
  “撤回了一条消息”，每次更新都是一条新通知；撤回还受企业管理员设置的时限约束
  （超时返回 `230009`），长任务可能已经撤不回。

## 媒体资源

- 正文里的资源标记：图片是 `img_xxx`（可能显示为图片标记或 `[image: img_xxx]`），文件/音频/视频
  `<file key="file_xxx" .../>`；`+messages-resources-download` 的 `--type` 只有
  `image` 和 `file`，音频/视频也走 `file`。sticker 不能下载。
- `--output` 只允许落在 **cwd、`/tmp`、`~/files`** 之内；插件把子进程 cwd 指到媒体目录，
  用相对路径落盘，不把任意绝对路径直接传给 CLI。
- 解析不到资源键时用 `+messages-mget --message-ids <om_...> --download-resources`
  只取这一条；资源会写进 `./lark-im-resources/`，输出里的 `resources[]` 带
  `{message_id,key,type,local_path,size_bytes}`。合并转发的资源必须用顶层容器
  消息 ID 取，子项 ID 会被拒。
- 下载需要 `im:message:readonly`；权限不足时单条资源失败，不阻断消息拉取。

## 三条"不要"

1. **不要用 `+chats-list`**（不存在），正确是 **`+chat-list`**（单数）。
2. **不要一上来拉全量会话**。实测账号有 2000+ 会话、翻 100 页还没到底。
   顺序应该是：`+search-user` 找人 → `+feed-shortcut-list` 取最近 → 最后才全量兜底（限页）。
3. **不要用 `+chat-messages-list` 的返回直接当正文**：正文可能在 `data.messages[].content`，
   旧版本在 `body.items[].body.content`，脚本双路径兜底；拿不到再走 `+messages-mget`。

## 字段位置

| 数据 | 实际路径 |
|---|---|
| 消息数组 | `data.messages`（不是 `body.items`） |
| 消息 ID | `message_id`（`om_` 开头 32+ 位，**别截断**） |
| 发送者 | `sender.id` |
| 正文 | `content`（mget 里在顶层 `content`） |
| 时间 | `create_time`（已是 `YYYY-MM-DD HH:MM:SS`） |
| 被引用消息 | `reply_to`（被引用消息的 `message_id`）；引用正文不在列表里，用 `+messages-mget --message-ids <逗号分隔>` 取（2026-11-23 实测，一次可传多个） |
| 会话列表 | `data.chats`（`+chat-list`）/ `data.shortcuts[].detail.chat_id`（shortcut） |

## sender / chat-id 从哪拿

- **推荐**：`contact +search-user --query "名字"` 一次拿到 `open_id` 和 `p2p_chat_id`，
  再用 `bootstrap.py --find feishu "名字"` 自动登记别名。
- 群：`im +chat-search --query "群名"`。
- 兜底：拉一轮历史，从消息里的 `sender.id` 取。

## 人物 ID（人物档案的键）

- 消息里的 `sender.id`（`ou_` 开头的 open_id）就是**人物 ID**，原样用作
  `~/.im-standin/profiles/people/feishu/<sender.id>.md` 的文件名，不 lower、不用显示名。
- `contact +search-user` 返回的 `open_id` 与消息 `sender.id` 是同一个值，按名字补人时直接对照。
- 群成员批量查用 `lark-cli im +chat-members-list --chat-id <oc_...> --member-types user --page-all`；
  返回 `users[]` / `bots[]`；`truncations[]` 非空表示服务端截断，人数不完整。只数 `users[]`
  就是「群里有多少人」，不要把人/机器人混在一起。
- 直接拉「@我」的消息：`lark-cli im +messages-search --is-at-me --chat-type group
  --start "<ISO 时间>" --end "<ISO 时间>" --page-all --no-reactions`。**已实测 2026-11-09**：
  它确实返回跨群的 @我 消息，结果含 `chat_id` / `chat_name` / `sender` / `content` /
  `mentions` / `create_time`。注意：它**也会返回 @all / @everyone**（例如告警卡片），
  引擎必须再用 `isMention()` 过滤，不能把 @all 当个人 @。适配器已接 `cmd_at_me` / `searchAtMe`；`--start/--end` 必须带本地时区偏移。
- 找「本人 @ 自己」的启动指令：同一个 `+messages-search` 加 `--sender <本人 open_id>
  --at-chatter-ids <本人 open_id>`，不传 `--chat-type` 可同时覆盖 p2p 与 group。**已实测
  2026-11-12**：p2p 结果也带 `chat_type` / `mentions` / `content`；p2p 的 `chat_name` 为空，
  只有 `chat_partner.open_id`，不能用显示名兜底。搜索服务端收窄后引擎仍需本地复核
  `isMention()` 与关键词；`--at-chatter-ids` 也会命中 @all，不能省过滤。
- **账号级消息流（spec 0065）**：`+messages-search` 不传 `--query`、只给 `--start/--end` 与
  `--chat-id a,b,c`，返回这些会话在窗口内的**全部**消息（p2p / group / topic / 卡片 / 本人消息），
  带 `data.has_more` / `data.total`。**已实测 2026-11-27**：12–20 分钟窗 49–102 条、13 个会话；
  32 个会话过滤只回这些会话的 1 条；单次 1.8–2.5 秒；流里最新消息比上一轮逐会话拉取还新
  60 秒。列表接口看不到线程 / 话题消息（固定 `only_thread_root_messages=true`），这条流能看到
  （结果里有 `chat_type=topic`）。`--chat-id` 只接受 `oc_` 开头，逗号分隔。
- **时间窗读的完整性**：`+chat-messages-list --start/--end --page-all --page-limit N` 返回
  `meta.pagination.complete`（繁忙群 page-limit 3 → 150 条 false；page-limit 10 → 348 条 true），
  引擎用它回答「窗口读全了没」。钉钉没有时间过滤，只能采样。
- 系统消息没有 `sender.id`，不给人物档案路径；私聊里要留就写进这个私聊的人物档案，
  群资料写群工作本，不要按显示名猜人。

## 坑位

1. 监听进程随 agent 会话存活；会话重启要重挂。`--init latest` 以当前最新为水位，不回溯存量。
2. 退出码 2 且报"连续 5 轮拉取失败"时，先查 `lark-cli auth status`。
3. 长文本回复走临时文件：`--text "$(cat /tmp/reply.txt)"`。
