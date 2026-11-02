# 0012 服务对象画像文件与消息指针

> 状态: 实施中
> 编号: 0012
> 版本: 0.8.0
> 关联: `docs/specs/contracts/01-api.md`、`docs/specs/contracts/02-storage.md`、`docs/architecture/02-data.md`、`docs/decisions/implemented/0004-profile-file-and-pointers.md`

## 背景

服务对象页现在展示的是 `env.json` 里 `targets.<platform>.<name>.profile`
的笔记数组：一条一行、带日期。它把「对这个人的认识」拆成了许多条历史观察，
用户要的是**一份可以直接读、直接改的目标客户画像**，不是一条条往回翻的记录。

同时 `panel.db.messages` 在本地保存了拉到的消息正文，包括已经回过、已经忽略、
只是知会的消息；`/api/thread` 也从这张表渲染。结果是本地在无界积累聊天原文，
而平台本身支持按 `chat_id` / `msg_id` 在线查询——本地真正需要留下的只是
「这条消息我知道、它是什么状态」的指针。

## 目标与非目标

- 目标：
  - 每个服务对象一份 Markdown 画像文件，落在
    `~/.im-standin/profiles/<platform>/<chat_id>.md`；面板「服务对象」页直接
    展示与编辑这份文件，不再展示逐条笔记或历史消息；
  - `env.json` 里已有的 `profile` 笔记在首次读取时一次性迁进画像文件的
    「历史结论」段，之后 `env.json` 只保留会话元数据；
  - 唤醒 agent 时把当前对象的画像路径带进 prompt，agent 起草前只读这一份画像；
  - 本地 `messages` 表收敛为**指针 + 待办索引**：`new` / `opened` 的私聊与 @我
    保留正文（收件箱和唤醒批次要用）；`replied` / `ignored` 以及 `fyi` / `out`
    一律清空正文，只留 `msg_id` / 时间 / 发送者 / 状态；
  - `/api/thread` 每次打开都从平台在线拉取正文；在线失败时才回退本地指针，
    并明确告诉面板「这是离线回退」。

- 非目标：
  - 不做离线历史归档；本地不再承担「翻旧聊天记录」的职责；
  - 不改拉取节奏、不增加定时拉取范围；
  - 不删除 `messages` 指针行（去重与待回状态仍靠它，删了会让旧消息重新变 `new`）；
  - 不替企微/钉钉造消息 ID；企微仍只能用时间窗在线查，钉钉仍不登录读不了；
  - 不改 agent 的回复闭环与发送入口。

## 方案

### 1. 画像文件

路径与命名：

```
~/.im-standin/profiles/<platform>/<file_id>.md
```

- `file_id` 优先用 `chats.chat_id`（只保留 `[0-9A-Za-z._-]`，其余替换成 `_`）；
  没有 `chat_id` 时用目标名做同样的清洗并追加 6 位哈希，避免同名覆盖。
- 目录 `0700`、文件 `0600`；写入走临时文件 + `os.replace`，保留一份内容在
  `env.json.bak` 之外不做额外备份（画像本身就是用户可编辑的正文）。
- 首次创建时写模板：

```markdown
# <目标名>

> <平台> · <chat_id>
> 画像由值守 agent 与面板共同维护：只写下次值守还会用到的信息，不保存聊天原文。

## 对方是谁

## 沟通偏好

## 在意与忌讳

## 历史结论
```

- 迁移：目标节点里旧的 `profile` 数组（`{note, at}` 或字符串）逐条去重后写成
  `- <note>` 放进「历史结论」段；写成功即从 `env.json` 节点删除 `profile` 键，
  并在节点写 `profile_file: "profiles/<platform>/<file_id>.md"`。
- `env.json` 仍是目标索引（`chat_id` / `open_id` / `kind` / `profile_file`），
  但**不再保存画像正文**；`bootstrap.py --note` 改为追加到画像文件。

壳内写入：DSH headless 的沙箱是 `workspace-write`，agent 写不了
`~/.im-standin`。因此唤醒 prompt 直接带「当前画像」；agent 学到长期有效的新事实时，
在最终回复末尾提交完整的新画像：

```
<!-- im-profile-update
<完整画像 Markdown>
-->
```

`TurnManager` 在 turn 成功后解析最后一个块，用宿主进程写回画像文件；没有块就
不改。这样内容仍由 skill 维护，插件只代为落盘，不扩大沙箱权限。

### 2. 面板

- 「服务对象」页每张卡片只展示：对象名、平台、值守状态、画像路径、画像正文的
  轻量渲染（标题 / 列表 / 段落，纯文本转义后渲染，不接第三方 Markdown 库）。
- 卡片提供「编辑画像」：切到 textarea，保存走 `POST /api/targets/profile`；
  保存后重新读文件并刷新列表。
- 删除「打会话」按钮、逐条笔记列表、笔记输入框与删除按钮。
- 「分身」页与收件箱详情里原先展示 `notes` 的位置改为画像摘要（首段非空文本）；
  没有画像时提示「还没画像，去服务对象补一份」。
- 会话详情仍然存在，入口只在收件箱/分身页；打开时走在线拉取。

### 3. 消息指针

`store.put_message()`：

| kind | 本地保留正文 |
| --- | --- |
| `dm` / `mention` / `service` | 是（待回闭环要用；`service` 仅存量） |
| `fyi` / `out` | 否，只存指针 |

状态变化时清正文：

- `set_state(..., "replied" | "ignored")` → `content=''`；
- `mark_replied_before()` → 更早的待回标 `replied` 并清正文；
- `set_blocked()` / `ignore_unwatched()` 批量标 `ignored` 时一并清正文；
- `store.trim_content()` 在服务启动和每轮定时结束时扫一遍，兜住老库里已经
  处理过但还留着正文的行。

保留整行指针，不按时间删除：下一轮拉取窗口里可能再次看到同一条消息，
行没了会被当成新消息重新进收件箱。

### 4. 在线会话正文

`Poller.fetch_thread(platform, chat_id, limit)`：

- 直接调 `Adapter.fetch_messages()`，不写入 `messages`、不推进水位；
- 返回最新在前；`api_thread` 统一转成时间正序给面板；
- 企微传 7 天时间窗（CLI 上限附近），Feishu 按 `limit`；
- 在线失败返回 `ok=false` 与脱敏后的错误。

`api_thread`：

1. `fetch=1` 时先走 `POLLER.fetch_once()` 完成「点开补拉 + 分类 + 唤醒」，
   并复用这次拉到的消息做展示（避免同一请求打两次接口）；
2. `fetch_once` 被冷却跳过或 `fetch=0` 时，调 `fetch_thread()` 只取正文；
3. 在线失败 → 回退 `store.thread()`（此时正文可能已被清空），响应带
   `offline: true` 与 `error`，面板显示「在线拉取失败，下面只有本地指针」；
4. 返回的行带 `is_self`，正文来自平台，不在本地落盘。

### 5. 接口

新增：

| 方法 | 路径 | 入参 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/targets/profile` | `platform`、`name`、`text` | 覆盖写画像文件；`text` 上限 64 KB |

`GET /api/targets` 每行新增：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `profile` | string | 画像 Markdown 正文 |
| `profile_path` | string | 画像文件绝对路径 |
| `profile_updated_at` | number | 文件 mtime（epoch 秒） |
| `profile_excerpt` | string | 首段非空文本，面板摘要用 |

删除：`GET /api/targets/note`、`GET /api/targets/note/delete`（面板不再有
逐条笔记；旧数据已在读取时迁进画像文件）。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 画像继续放 `env.json` 的 `profile` 数组 | 用户要的是一份可读可改的画像，不是逐条历史；`env.json` 也会越写越像聊天记录 |
| 所有对象共用一份 `profiles.md` | agent 每次要读全部对象，违反 skill 的「最小上下文」 |
| 消息正文全部不落库 | 收件箱预览、唤醒批次、待回计数都依赖待回复正文；每轮都线上拉会让轮询成本翻倍 |
| 按时间删 `messages` 行 | 消息再次进入拉取窗口时会被当成新消息，重新变待回 |
| 继续用本地表渲染会话正文 | 与「线上能查」重复，而且本地必然越积越多 |

## 影响面

- 代码：
  - `dsh-plugin/service/targets.py`、`store.py`、`poller.py`、`server.py`、`turns.py`
  - `dsh-plugin/web/panel.js` + 重新构建的 `dsh-plugin/lib/client.js`
  - `scripts/bootstrap.py`、`SKILL.md`
- 契约：`docs/specs/contracts/01-api.md`（targets 字段、profile 路由、thread 语义）、
  `docs/specs/contracts/02-storage.md`（`messages.content` 的保留规则）。
- 用户可见：服务对象页变成画像文件；已处理消息的历史正文本地不再保留；
  打开会话时正文来自平台，失败时显示离线回退。
- 兼容：旧 `env.json` 的 `profile` 笔记首次读取自动迁移；旧 `panel.db` 里已处理
  行的正文在下一次启动/轮询后清空；老客户端若仍调用 note 路由会 404。

## 验收

- [ ] 加入一个值守对象后，`~/.im-standin/profiles/<platform>/<chat_id>.md` 出现，
      `env.json` 节点有 `profile_file`、没有 `profile`。
- [ ] 面板「服务对象」页显示画像正文与路径；编辑保存后重新打开页面内容还在；
      页面没有逐条历史消息、没有「打会话」。
- [ ] 旧 `env.json` 里有 3 条 `profile` 笔记 → 首次读取后画像文件「历史结论」
      段有 3 条 `-` 列表项，`env.json` 不再有 `profile` 键。
- [ ] 收到一条私聊并唤醒 → `messages.content` 有正文；把它标 `replied` 后
      `content=''`、行还在；再跑一次 `store.trim_content()` 仍是空。
- [ ] `fyi` / `out` 消息入库后 `content=''`，但 `ts_epoch` / `msg_id` / `state`
      可用于去重与排序。
- [ ] 打开一个会话 → `/api/thread` 返回平台在线消息；断网/CLI 失败时返回
      `offline=true` 且仍有本地指针行。
- [ ] 唤醒 prompt 含当前画像正文与路径；turn 成功的回复里带
      `<!-- im-profile-update ... -->` 块时，画像文件被更新；没有块时不变。
- [ ] `SKILL.md` 的起草步骤只读当前画像；壳内分支写明用更新块提交，不直接写
      `~/.im-standin`。
- [ ] `python3 -m unittest discover -s tests`、`python3 tests/run_tests.py`、
      `bash scripts/gate.sh --quick` 全绿。

## 风险与回滚

- 风险：在线拉取失败时用户看不到旧正文；这是有意的取舍，面板明确标注「离线回退」，
  且待回复正文仍在本地。
- 风险：企微只能按时间窗查，超过窗口的历史无法在线补；本地面板不假装能补。
- 风险：清空正文不可逆（本地），但平台侧原文仍在，且已有 `sends` 审计不受影响。
- 回滚：画像文件保留不影响旧代码（旧代码只读 `env.json`）；把 `targets.py` 的
  迁移逻辑撤掉即可回到笔记模式。消息正文清理逻辑集中在 `store`，可单独 revert。
