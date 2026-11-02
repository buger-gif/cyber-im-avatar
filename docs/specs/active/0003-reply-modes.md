# 0003 回复模式（prompt 模板集）

> 状态: 已放弃
> 编号: 0003
> 版本: 0.1.0
> 关联: `docs/specs/contracts/02-storage.md`、`docs/specs/contracts/03-config.md`
>
> 放弃原因：回复模式/自动发/风险闸门属于插件侧起草管道，0004 把脑子还给 agent 后
> 整体下线；行为与列的处置见 `docs/specs/archive/0004-skill-shell.md §退役清单`。

## 背景

客服起草目前只有一条固定 prompt 流（persona → 对方档案 → 工作区提示 → 上下文 → 任务），
所有 service 会话无论场景一律「调研后直接出一条回复」。实际使用里至少有三类节奏没被覆盖：

1. 熟人短消息 —— 不需要调研，但希望先应一声「收到」，表示人在。
2. 需要核实事实的消息 —— 应该先应答，再去工作区调研，最后正式回复；现状只能干等一轮跑完。
3. 复杂请求 —— 直接替本人答应有风险，应该先回一个方案要点，等对方 ok 再落实。

## 目标与非目标

- 目标：回复节奏做成**按会话配置**的模式，每个模式对应一组 prompt 模板与流程；
  新模式先立 spec（本文件）再实现。
- 非目标：
  - 不做「对方 ok」的语义级自动判定（只做严格白名单，默认人工确认）；
  - 不做多语言 ack 话术库（默认中文模板，用户可改）;
  - 不改起草引擎选择（dsh/api/auto 逻辑原样）。

## 方案

### 模式集（v1 四个）

| mode | 名字 | 流程 | LLM 轮数 |
| --- | --- | --- | --- |
| `direct` | 直接回复（现状，默认） | （调研）→ 出一条回复 | 1 |
| `ack` | 先应答再回复 | 固定话术应答（0 LLM）→ 调研 → 出正式回复 | 1 |
| `plan` | 先方案后执行 | （调研）→ 出方案发对方 → 等对方 ok → 出落实回复 | 2 |
| `clarify` | 先澄清 | 单轮内判断信息是否足够 → 不足则只回澄清问题 | 1 |

### 存储（chats 表新增 3 列）

```
reply_mode    TEXT DEFAULT 'direct'   -- direct | ack | plan | clarify
reply_state   TEXT DEFAULT ''         -- '' | awaiting_plan_ok（plan 模式：方案已发等 ok）
reply_state_at REAL DEFAULT 0         -- 进入当前状态的时刻
```

老库 `_migrate` 补列，默认 `direct`，行为与现状完全一致。
契约同步：`02-storage.md`。

### 配置（panel.json 新增 `reply` 段）

```
reply: {
  ack_templates: [        // ack 模式的固定话术，按会话 hash 固定选一条，避免每次措辞不同
    "收到，我看一下，稍后回你。",
    "收到，我先核实下细节。",
    "在的，这个我确认下再答复你。"
  ],
  plan_ok_words: ["ok", "好", "可以", "行", "嗯", "同意", "没问题", "就按这个"],
  plan_auto_ok: false     // true=对方消息命中白名单就自动进第二轮；false=面板人工点确认
}
```

契约同步：`03-config.md`。normalize 夹紧：ack_templates 非空数组、plan_ok_words 去空白去重、
plan_auto_ok 强制布尔。

### 各模式的 prompt 模板（draft.py MODES 注册表）

`build_prompt` 增加 `mode` 与 `phase` 参数，`## 任务` 段按模式替换，铁律/风格/档案段共用：

- `direct` / phase=`reply`：现状文案「起草本人对上面这条消息的回复正文」。
- `ack`：
  - phase=`ack`：不走 LLM（见下）；
  - phase=`reply`：同 direct，但 header 里带「(已先应答)」，任务段提示
    「此前已用固定话术应答过，正式回复不要再说"收到"」。
- `plan`：
  - phase=`plan`（state 为空时）：任务段换成
    「先给对方一个 3–5 行的方案：打算做什么、需要对方确认什么、大概多久。不下结论、
    不承诺、不涉及钱与合同；仍然只输出一条 IM 正文」。
  - phase=`reply`（state 为 `awaiting_plan_ok` 时）：任务段换成
    「对方已同意上面的方案，按方案给出落实回复；落实里出现的新事实仍按铁律处理」。
- `clarify`：任务段要求模型先判断待回消息的信息是否足够；
  - 足够 → 正常输出回复正文；
  - 不足 → 输出以 `CLARIFY:` 前缀开头的一句澄清问题。
    代码按前缀分流：命中则草稿正文去掉前缀、state 标记 `clarified`（只影响收件箱备注，不阻塞）。

ack 话术**不走 LLM、不走风险闸门**：模板固定中性、不含任何事实，直接发。
发送失败只记 `last_error`，不阻塞后续正式起草。
同一会话 **10 分钟冷却**：对方连发多条只应答第一条，不刷屏（自审补充，2026-11-01）。

### 流程状态机（poller._service_msg）

```
新消息（service 会话）
 ├─ mode=ack 且 state=''   → 发 ack（sends 留痕）→ 继续 direct 式起草
 ├─ mode=plan 且 state=''  → 起草 phase=plan → auto_send 通过闸门则发出
 │                           → state='awaiting_plan_ok'
 ├─ mode=plan 且 state='awaiting_plan_ok' 且新消息命中 plan_ok_words
 │    ├─ plan_auto_ok=true  → 起草 phase=reply → state=''
 │    └─ plan_auto_ok=false → 不自动起草，收件箱标记「对方已回，确认继续」；
 │                             人工确认（面板按钮）后走 phase=reply → state=''
 ├─ mode=clarify           → 单轮起草，按 CLARIFY: 前缀分流
 └─ 其余                   → 现状 direct 行为
```

任何一步起草失败：`reply_state` 清空，退回 direct 行为，`last_error` 留痕。
`dsh.pre_draft=false` 时 ack 仍发（它零成本），plan/clarify 照旧等人工点「起草」。

### 接口（server.py）

- `POST /api/chat/set`（现有路由）增加字段 `reply_mode`，白名单校验四值之一。
- 新增 `POST /api/chat/plan-confirm`：body `{platform, chat_id}`，
  仅 `reply_state='awaiting_plan_ok'` 时有效 → 清 state 并触发 phase=reply 起草。
- `/api/state` 的会话行透出 `reply_mode`、`reply_state`。

### 面板（web/panel.js）

- service 会话详情：加「回复模式」四选一（direct/ack/plan/clarify），即时保存。
- plan 会话在 `awaiting_plan_ok` 状态时，会话行显示「对方已回，确认继续」按钮
  （调 `plan-confirm`）。
- 设置页「全自动客服」卡：ack 话术列表编辑 + plan_auto_ok 开关。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 模式做成全局配置 | 不同人需要不同节奏；per-chat 是最小正确粒度，全局默认 direct 已够 |
| ack 用 LLM 生成 | 多一轮 token 与秒级延迟，中性应答用固定话术足够 |
| 「对方 ok」做语义判定 | 误判等于替本人承诺；v1 只做严格白名单且默认人工确认 |
| clarify 独立两轮（先判后问） | 单轮加输出前缀即可分流，省一半调用与延迟 |
| 模式状态存 panel.json | 状态是 per-chat 且随消息流转，落 chats 表才是单事实源 |

## 影响面

- 代码：`service/draft.py`（MODES 注册表 + build_prompt 按 mode/phase）、
  `service/poller.py`（_service_msg 状态机 + ack 直发 + ok 白名单判定）、
  `service/store.py`（3 新列 + setter）、`service/server.py`（2 路由改动）、
  `web/panel.js`（模式选择器 + 确认按钮 + 设置项）
- 契约：`02-storage.md`（chats 新列）、`03-config.md`（reply 段）同 commit 改
- 用户可见：面板会话详情多一组模式选择；ack 模式会**真实发送**应答消息（sends 留痕）
- 兼容：老库自动补列、默认 direct，不开新模式则行为与现状逐字节一致

## 验收

> 按要求全程走沙箱替身（FakeAdapter / FakeDrafter，临时 `IM_STANDIN_DIR`），
> 未触碰线上 `~/.im-standin` 数据、未真实发送任何 IM 消息。

- [x] 某会话设 `reply_mode=ack`，注入新消息 → sends 表立刻多一条 ack 记录、
      无 LLM 调用；正式草稿 prompt 的 header 含「已先应答」（tests/test_reply_modes.py）
- [x] 设为 `plan` → 第一份草稿为方案要点（任务段要求不下结论不承诺）；
      注入「ok」消息 → `plan_auto_ok=false` 时触发 plan_confirm 事件等人工确认，
      点击 `confirm_plan` 后出第二轮草稿；`plan_auto_ok=true` 时自动出第二轮
- [x] `clarify` 会话 → 模型输出按 `CLARIFY:` 前缀分流，澄清问题去前缀入草稿
- [x] 老库自动补列，全部会话默认 `reply_mode=direct`；66 个单测全过
- [x] `python -m unittest` 全过 + `bash scripts/gate.sh` 六项 PASS（2026-11-01）

未做（按「不动线上」要求保留）：真机面板上四个模式的手动点验——留给使用者
下一次真实消息自然到达时观察，后端行为已有替身测试覆盖。

## 风险与回滚

- 风险：
  - ack 直发绕过闸门 —— 话术固定中性、不含事实，风险可控；
  - plan 第二轮理解歪方案 —— 仍受铁律 + 风险词闸门 + auto_send 白名单兜底；
  - ok 白名单把「行吧」当同意 —— 白名单是全等匹配（去标点）不是包含，「行吧」不命中。
- 回滚：把会话切回 `direct` 即回到现状；新列带 DEFAULT 无需清库；
  极端情况撤掉 panel.js 模式选择器即可，后端对未知 mode 一律按 direct 处理。
