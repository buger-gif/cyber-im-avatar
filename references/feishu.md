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
- 群成员批量查用 `lark-cli im +chat-members`（命令名以本机 `lark-cli im --help` 为准，
  本仓库未实测）；宁可查一次，也不要按显示名认人。
- 系统消息没有 `sender.id`，不给人物档案路径；私聊里要留就写进这个私聊的人物档案，
  群资料写群工作本，不要按显示名猜人。

## 坑位

1. 监听进程随 agent 会话存活；会话重启要重挂。`--init latest` 以当前最新为水位，不回溯存量。
2. 退出码 2 且报"连续 5 轮拉取失败"时，先查 `lark-cli auth status`。
3. 长文本回复走临时文件：`--text "$(cat /tmp/reply.txt)"`。
