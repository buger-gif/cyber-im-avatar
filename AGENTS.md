# cyber-im-avatar — 项目指引（给 AI 会话）

> 给下一个会话的入口。用户视角的介绍在 `README.md`，文档规矩在 `docs/AGENTS.md`，
> 当前断点在 `docs/implementation/PROGRESS.md`。

## 一句话

把办公 IM 分身挂起来：有人发消息才叫醒 AI，没人说话零成本。同一个仓库两种形态——
Skill（agent 被唤醒后跑闭环）与 DSH 插件（常驻面板：收件箱、画像、手动发送）。

## 设计铁律（改代码前先背下来）

1. **不监听任何端口。** 面板走 DSH 的同源路由，后端是宿主进程内的 Node 模块。想加端口 = 架构回退，
   需要新 ADR 说明为什么翻案（`docs/decisions/implemented/0001-zero-port.md`）。
2. **定时拉取下限 10 分钟；群默认不拉。** 群只有 `timer=1` 才进轮询。
   成本模型见 `docs/architecture/02-data.md §拉取节奏`。
3. **屏蔽即不同步。** `blocked` 的会话定时、点开、手动三条路都不进，只在 `candidates()` /
   `pollChat()` 收口判断。
4. **运行时零第三方依赖。** 插件后端只用 Node 标准库，前端只交构建产物 `lib/client.js`；
   dev 工具可以加，但不能让「clone 下来就能跑」变复杂。
5. **消息正文只在本机。** 不上传、不进日志；插件不读模型凭据，也不回传。
6. **承认平台差异。** 企微没有消息 ID、钉钉不登录读不了——写进 `references/`，不假装适配过。
7. **迁移只放宽。** 补字段的默认值不得改变存量会话的行为（群补 `timer=-1`，不是 0）。

## 动手前

1. `docs/implementation/PROGRESS.md` — 断点与挂账。
2. 在办 spec：`docs/specs/active/`（没有就先按 `docs/AGENTS.md §4` 写一个）。
3. 涉及路由 / 表 / 配置键：先看 `docs/specs/contracts/` 对应契约——**改代码与改契约同一个 commit**。
4. 为什么长这样：`docs/architecture/`；某个选择为什么不是别的方案：`docs/decisions/`。

## 动手后（收尾三件套）

1. `bash scripts/gate.sh --quick` 全绿（秒级；发版跑全量 `bash scripts/gate.sh`）。
2. `docs/implementation/PROGRESS.md` 改到最新断点；当日事实追加进
   `docs/implementation/log/YYYY-MM-DD.md`。
3. 用户可见行为变了 → `CHANGELOG.md`；架构取舍变了 → `docs/architecture/` + ADR。

## 环境速查

```bash
cd dsh-plugin
./scripts/start-dsh.sh --restart                          # 开发 DSH（3080）
node --test                                               # 插件 Node 测试
node scripts/migrate-state.mjs --dry-run                  # 迁移预演（只打印）
python3 ../tests/run_tests.py                             # skill 全量
bash scripts/gate.sh --quick                              # 提交前静态层
```

## 停下来问用户的时机

- 要引入任何第三方运行时依赖
- 要开监听端口、写文件到 `~/.im-standin/` 之外、或上传任何消息内容
- 要以用户身份对外发送，且不在值守会话的草稿确认流里
- spec 的「非目标」要被突破，或要翻已 implemented 的 ADR
