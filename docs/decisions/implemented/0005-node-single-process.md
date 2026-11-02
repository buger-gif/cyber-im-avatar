# 0005 Node 单进程：file state + 宿主 live turn

> 状态: implemented
> 日期: 2026-11-02
> 关联: spec 0013

## 背景

0.8.x 的插件为了「管一个 skill」有四层额外结构：DSH 宿主路由转发到 Python stdio
子进程、SQLite 存 chats/messages/sends、`dsh headless` 子进程跑每轮会话。
真实故障集中在这些层：DSH 界面打开值守会话后，web 进程生命周期持有 `session.lock`，
headless 唤醒必报 `session_locked`；状态跨进程靠管道事件同步；每会话正文无界增长。
用户要求：除 UI 外全部推倒，用 Node 重写，只留 10 条缓存。

## 决策

插件后端改为 DSH 宿主进程内的 Node 模块；唯一状态是 `state.json`；唤醒直接复用
宿主里的 live agent（`sessionController.resolveAgent` + `agent.followup`）。

## 备选

| 备选 | 为什么不行 |
| --- | --- |
| 保留 Python stdio 子进程，只把 SQLite 换文件 | 没解决核心问题：仍有两套运行时、一套管道协议、两套测试；会话锁与跨进程状态照旧 |
| 保留 headless 子进程，只把存储换文件 | `session.lock` 冲突不消失；UI 打开值守会话时仍无法唤醒 |
| 继续用 SQLite，只把后端换成 Node | `node:sqlite` 要求 Node 22+，且为了 10 条指针与 73 个会话维护表结构/迁移不划算；文件可直接读、可备份、可手工修 |
| 用 `agent.inject()` 代替 `followup` | `inject` 是上下文注入，不是用户 prompt；不会打开一轮、不产生 `turn/end`，无法判断这轮是否完成 |
| 在宿主里自己轮询浏览器 DOM/UI | 依赖 UI 实现，版本一升就碎；且拿不到 agent 生命周期 |

## 后果

- 接受：一个 DSH 宿主进程写 state；桌面 app 与 3080 同时跑会抢会话，只应留一个。
- 接受：local 只留 10 条指针，更早消息必须在线查；未读/待回计数按 10 条封顶。
- 接受：插件依赖 DSH 的 `sessionController` / `sessions` / `session/event` 内部能力；
  这些不是稳定公开 API，DSH 升级需回归 live turn。
- 重新考虑的触发条件：DSH 不再暴露 `sessionController.resolveAgent`/`followup`；
  或需要离线检索大量历史（那时应引入独立存储，而不是把 SQLite 塞回宿主进程）。
