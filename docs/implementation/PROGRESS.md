# PROGRESS — 当前断点

> **新会话第一读取点。** 这份文件只回答三个问题：现在到哪了、什么被挂起了、下一步动哪里。
> 写法见 `docs/AGENTS.md`：活文档，就地改写，不做历史（历史在 `docs/implementation/log/`）。

## 更新时间

2026-11-03（0.10.0 已发布：npm latest=0.10.0，CI 绿；spec 0024「群聊关注程度」待在桌面
DSH 重启后走真机验收，通过后归档；真实客户命中与真实平台媒体仍待命中）

## 最近批次

| 日期 | 主题 | 证据 |
| --- | --- | --- |
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

- **0.9.0 代码面已完成**：`docs/specs/active/` 已清空；本轮按 panel / 验收归档 / 收尾
  三组主题本地提交（含后续修正），工作区干净、已推 main；已有会话的后续醒来只发消息行，
  完整上下文只在首轮载荷里出现。0013、0017–0023 全部逐条对勾后
  `git mv` 进 `docs/specs/archive/`，归档表已登记。ADR 0006 已从 proposed 移到 implemented。
- **0.9.0 已发布**：npm `dist-tags.latest = 0.9.0`（publish 时间 2026-11-03T08:59:09Z）；
  `v0.9.0` tag 指向发布代码 `82c11a0`，`market/index.json` 按 runbook 在其后单独提交，
  已由 `make-market-index --source npm` 重生成到 0.9.0 并通过 format-1 校验。CI 的「版本自检」只等 10 秒，registry 复制约 2 分钟，
  该 run 曾误报红；自检已改成最多轮询 3 分钟。
- **验证环境**：3080 使用 `IM_STANDIN_DIR=/tmp/im-standin-accept` 的隔离状态，只有合成会话
  `oc_e2e_local_only`；web profile 已 link 本地插件。**没有向真实客户外发**，也没有拉真实消息。
- **合成 live turn**：`chatWake` 创建 `session-76a20026…` → turn/end → `session_turns=1`、
  `last_ok=true`、post-turn `last_sync` 更新；会话元数据出现 `danger-full-access`，agent 直接
  写了 `profiles/feishu/oc_e2e_local_only.md`。无效 chat_id 的 CLI 报错是该演练的预期结果。
- **关注摘要**：同一合成会话连续两轮更新，同一对象始终一行、无重复；把未结项放进
  `2026-11-02.md` 后，今天的文件带回该行且 `首次` 仍是 11-02；删掉今天文件，面板显示
  「今天还没有日报」。
- **重开会话**：空闲时 `{ok:true, interrupted:false}`，运行中 `{ok:true, interrupted:true}`；
  两种情况下 `dsh_session=""`、`session_turns=0`。面板确认文案与 toast 均在 360/420 验过。
- **快车道**：slow=1793690337.48；fast=1793690397.95 → 1793690458.43 → 1793690518.95，
  约 60 秒一跳，slow 在 160 秒观察窗内未变。体检页读到「值守 60 秒（N 个会话） · 发现 10 分钟」；
  设置页保存 45 秒后 `/api/status` 立即读到新值。
- **面板走查**：320 / 360 / 420，浅/深两套，六个页签；`.ims-panel` 各宽度
  `scrollWidth === clientWidth`，越界元素 0；设置页三个数字框均 92px；详情「重开会话」
  在 DSH 会话行右侧不换行。走查截图在本地临时目录（未入库）。
- **测试**：`node --test` 103/103；`python3 -I tests/run_tests.py` 110/0；
  `bash scripts/gate.sh` 全量六项全绿。
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
2. **历史待回清理**：旧库迁移带来的约 50 条 pending 是否在「收件箱 → 清理」一次，待用户拍板。
3. **0.5.0 屏蔽的 UI 端到端截图**：功能已过测试，截图验证仍中断。
4. **钉钉真发与真人闭环**：插件已支持轮询 / 唤醒 / 发送，但真实发送仍只到 dry-run。
   真发前要定 `--ai-tag` 口径（默认给消息打 AI 标识）；再找一个真人会话跑完
   「命中 → 草稿 → 发送 → 重挂」。

## 下一步

1. 等真实客户消息/媒体命中；只观察，不主动给真实客户发消息。
2. 用户确认后清理历史待回；清理前不要当作用户已同意。
3. 钉钉补完真人闭环：在环境里启用钉钉，给一个真人会话跑「命中 → 草稿 → 发送 → 重挂」，
   先定 `--ai-tag` 口径。

## 规则性提醒

- 改路由 / state 字段 / 配置键 → 同 commit 改 `docs/specs/contracts/`，否则测试红。
- 收尾跑 `bash scripts/gate.sh --quick`；发版跑全量。
- 版本号三处一致：`dsh-plugin/package.json`、`CHANGELOG.md` 顶部、git tag。
- 一个 DSH 宿主写 state；别同时开桌面 app 与 3080 值守同一批会话。
- 公开仓库不写真实消息、真实 ID、本机路径与凭据；演练只用合成夹具。
