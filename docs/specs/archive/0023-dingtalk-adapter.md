# 0023 插件壳支持钉钉（dws）

> 状态: 已验收
> 编号: 0023
> 版本: 0.9.0
> 关联: `docs/specs/contracts/01-api.md`、`docs/specs/contracts/03-config.md`、`references/dingtalk.md`

## 背景

skill 形态的钉钉链路已在 2026-11-03 真机跑通：`dws auth login`（组织闸门已开）、
`dws profile list` 取 `userId`、`chat +chat-messages` 命中真实会话、水位推进。
插件壳（`dsh-plugin/lib/`）仍只加载飞书 / 企微 adapter：`state.js` 的
`SUPPORTED_PLATFORMS` 只有两个，诊断为「插件壳不支持」，面板体检页也因此只出现两张
平台卡片。结果是同一台机器上 skill 能值守钉钉，插件不能，用户看到的体检页像缺了一块。

## 目标与非目标

- 目标：插件按现有轮询 / 唤醒 / 发送闭环支持钉钉，体检页明确列出飞书 / 企微 / 钉钉三平台。
- 目标：体检页不再随面板 60 秒自动刷新；进入页签取一次快照，之后只由用户点按钮更新。
- 非目标：钉钉富媒体下载（图片 / 文件 / 语音 / 视频）——命令未实测，首版只给正文占位，
  agent 仍可用 CLI 自己取；不做 `dws event +listen-im` 事件流；不做多组织切换。

## 方案

### 1. 平台启用

`config.platforms` 仍是唯一开关，默认保持 `["feishu","wecom"]`——存量用户升级后行为不变。
新增 `POST /api/platforms`：`{platform, enabled}`，只接受三个已知平台；写回 `config.platforms`
并按 `SUPPORTED_PLATFORMS` 去重排序。加入钉钉会话值守（`/api/watch`）时，若平台未启用则一并启用。

体检页固定渲染三张平台卡片：未启用的平台显示「未启用」和「启用」按钮，不跑 `whoami`、
不显示授权失败；已启用的平台照旧显示授权、会话数、错误。

### 2. 身份与命令

`dsh-plugin/lib/im.js` 增加 `ADAPTERS.dingtalk`：

| 用途 | 命令 |
| --- | --- |
| 身份 | `dws profile list` → `profiles[0].userId`；空数组视为未登录，不回退缓存 `self_id` |
| 读消息 | `dws chat +chat-messages --group <conversationId> --limit N`（chat_id 含 `cidr`）或 `--user <userId>` |
| 发消息 | `dws chat +messages-send --as user --chat-id <conversationId> --text …` 或 `--user <userId>` |
| 最近会话 | `dws chat +recent-conversations` → `data.conversations[]` |
| 搜人 | `dws contact user search --query …` |
| 搜群 | `dws chat +chat-search --query …` |

字段映射按真机 ledger：`messages[]` / `messageId|msgId` / `senderId` / `text` / `createTime`；
默认 `order=desc`，取回后统一成「最新在前」（与飞书一致）。

发送保留 CLI 默认的 AI 标识（不显式传 `--ai-tag=false`），与 skill 侧一致；`references/dingtalk.md`
写明对方可能看到 AI 角标。富媒体类型（image / file / audio / video）只做正文占位，
`MEDIA_ADAPTERS` 不登记钉钉，唤醒 prompt 仍提示「可用 CLI 取」。

### 3. 轮询与诊断

`SUPPORTED_PLATFORMS` 增加 `dingtalk`；`legacyPlatforms()` 只收未知平台，不再固定把钉钉
报成「插件壳不支持」。`status()` 改为遍历全部三个平台：未启用的内容仍出现，但跳过
`whoami`，`enabled=false`。`doctor()` 同样对未启用平台只加一条 `warn`「未启用」，
不把它当成授权失败。

### 4. 体检页手动更新

面板 `tick()` 在 `tab === "status"` 时不再自动 `loadStatus()`；切到体检页时取一次快照。
页签顶部保留「刷新」与「跑一次体检」两个按钮，只有点它们才重新取数。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 默认把钉钉加进 `platforms` | 没装 `dws` 的用户每轮白跑一次 CLI，体检页多一张红色失败卡 |
| 只靠 skill 形态 | 用户明确要插件闭环；两套实现会分叉 |
| 首版连媒体下载一起做 | `dws` 下载命令未实测，猜出来的字段比不做更容易误导 |
| 体检页继续跟 60 秒刷新 | 每次刷新都会触发计数与重绘，体检本身是低频动作 |

## 影响面

- 代码：`lib/im.js`（adapter、会话/搜索字段泛化）、`lib/state.js`（`SUPPORTED_PLATFORMS`）、
  `lib/poller.js`（status / doctor / legacy）、`lib/app.js`（`/api/platforms`、watch 自动启用）、
  `web/panel.js`（平台卡、搜索下拉、手动刷新）。
- 契约：`docs/specs/contracts/01-api.md`（新路由与 `status.platforms[].enabled`）、
  `docs/specs/contracts/03-config.md`（`platforms` 允许 `dingtalk`）。
- 用户可见：体检页三平台；钉钉可加入值守、唤醒、发送；面板不再自动刷新体检。
- 兼容：`state.json` 结构不变，`platforms` 缺省行为不变；已有钉钉会话从「不支持」变为可拉取。

## 验收

- [x] 未启用钉钉时 `/api/status` 返回三平台，钉钉 `enabled=false`、`detail=未启用`，且不调 `dws`
- [x] 点「启用」→ `config.platforms` 含 `dingtalk`，`/api/status` 的 `logged_in=true`、`self_name` 可读
- [x] `dws profile list` 空数组 → `whoami` 返回未登录（`ok:false`、`self_id:null`），不吃缓存
- [x] 桩 `dws` 跑一轮：`+chat-messages` 的 `messages[]` 解析出 `msg_id/sender_id/content/ts_epoch`
- [x] 会话 ID 含 `cidr` 走 `--group`，`userId` 走 `--user`；`+messages-send` 同样分流（桩 calls.log 核对）
- [x] 体检页不随 60 秒刷新：`tick()` 在 `tab=status` 时跳过 `loadStatus()`，切页签与「刷新」按钮各自取一次；
      未做浏览器自动化，按代码路径与构建产物验收
- [x] `node --test` 110/110；`bash scripts/gate.sh` 全量六项全绿

## 风险与回滚

- 风险：`dws` 未登录或组织闸门未开时，启用钉钉只会看到一条授权失败；这是真实状态，不是回归。
- 风险：发送默认带 AI 标识，用户若要求「像本人」需另开子项（`--ai-tag=false`），本次不改默认。
- 回滚：把 `dingtalk` 从 `config.platforms` 移除即停止拉取；代码回滚只需撤本 spec 对应的 commit，
  存量钉钉会话会退回「不被插件拉取」。
