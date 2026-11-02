# 钉钉平台指南（dws / DingTalk Workspace CLI）

> 出问题先看 [troubleshooting.md](troubleshooting.md)（§B 未登录最常见），
> 或 `dws doctor --json`（自带 `hint` 字段，按提示做即可）/ `python3 scripts/doctor.py dingtalk`。

## 实测基线

- CLI：`dws`（npm 包 `dingtalk-workspace-cli`，实测 v1.0.66）
- 安装：`npm install -g dingtalk-workspace-cli`
- 授权：`dws auth login`（OAuth 设备码，需要企业管理员开通 CLI 访问），状态 `dws auth status`
- 本人 ID：`dws profile list` → `profiles[].userId`（未登录时返回空数组，且 `authenticated: false`）

## 真实命令（已实测，未登录时行为已核对）

| 用途 | 命令 |
|---|---|
| 登录状态 | `dws auth status` |
| 本人账号 | `dws profile list` |
| 读群消息 | `dws chat +chat-messages --group <群名或openConversationId> --limit 20` |
| 读单聊 | `dws chat +chat-messages --user <userId> --limit 20` |
| 最近会话 | `dws chat +recent-conversations` |
| 搜群 | `dws chat +chat-search --query "关键词"` |
| 搜人 | `dws contact user search --query "关键词"` |
| 发单聊 | `dws chat +messages-send --as user --user <userId> --text "..."` |
| 发群聊 | `dws chat +messages-send --as user --chat-id <openConversationId> --text "..."` |
| 按姓名发 | `dws chat +dm --to 姓名 --content "..."`（内部解析唯一 userId） |

## 四个坑

1. **目标参数互斥**：`--group` 用于群聊，`--user` / `--open-dingtalk-id` 用于单聊，一次只能给一个。
   所以适配里群聊走 `cmd_list`、单聊走 `cmd_list_user` 两套模板。
2. **stdout 可能是多段 JSON**：先打结果 ledger，再打一个错误块。
   引擎用 `raw_decode` 只取第一个 JSON 文档，`json.loads` 会直接失败。
3. **默认 `order=desc`**（最新在前），与企微相反。适配里显式写 `"order": "desc"`。
4. **不能裸信 `messages[].sender` 展示名**：身份比较一律用 `senderId`；
   CLI 自己也标了 `identity_unverified` 语义，拿展示名做否定结论是错的。

## 消息 ledger 的关键字段

`+chat-messages` 返回 `messages[]` / `count` / `hasMore` / `complete` /
`failures[]` / `stopReason` / `truncated`。
`complete=false` 或 `failures` 非空表示**结果不完整**，不能当成"没有新消息"。

## 校准流程

```bash
dws auth login                       # 先登录，否则 profile list / 读消息都会失败（rc=5）
python3 scripts/bootstrap.py --probe dingtalk --user-id <userId>
python3 scripts/bootstrap.py --selftest dingtalk <userId>
```

字段或命令变了，写 `~/.im-standin/env.json`：

```json
{ "overrides": { "dingtalk": { "cmd_list_user": ["chat","+chat-messages","--user","{user_id}","--limit","20"],
                               "f_items": [["messages"]] } } }
```

## 事件式监听的另一种可能

dws 自带 `dws event +listen-im --kind ...`（常驻事件流）。本 skill 不用它，
原因是：常驻进程不返回、无法"命中即退出 → agent 处理 → 重挂"，
与单发唤醒模型冲突。需要秒级实时性时再单独评估。
