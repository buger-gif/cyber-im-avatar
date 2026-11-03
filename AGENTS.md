# cyber-im-avatar — 项目指引（给 AI 会话）

> 这是**公开开源仓库**（MIT）。给下一个会话的入口：用户视角在 `README.md`，
> 文档规矩在 `docs/AGENTS.md`，当前断点在 `docs/implementation/PROGRESS.md`。

## 项目目标

只做一件事：**你不在的时候，以你本人身份替你值守一个办公 IM 会话**。
新消息进来才唤醒 agent，没人说话时几乎不花 token（每小时一次缓存续期）。

- 能落地：飞书 / 企业微信 / 钉钉，复用本机 CLI 登录态，不代管密码。
- 两种形态：Skill（`SKILL.md` + `scripts/`）与 DSH 插件（`dsh-plugin/`，常驻面板）。
- 做对的标准：**不静默失效、不替你说错话**；宁可不回，也不乱回。

非目标：不做群发 / 营销机器人，不做多租户 SaaS，不为面板另起监听端口。

## 开源仓库红线（每次 commit 前自查）

公开仓库里**一律不得出现**：

- **真实消息记录**：聊天原文、联系人姓名、头像、手机号、邮箱、`open_id` / `userid` / `chat_id`、真实群名。
- **凭据**：`panel.json` 的 `api_key`、`~/.dsh/.credentials.yaml`、AK/SK、cookie、web-token、任何 token 原文。
- **个人痕迹**：`/Users/<你的名字>/...` 这类本机路径（文档写 `~/cyber-im-avatar`）、个人邮箱、内网域名 / 工作区名。
- **本地运行数据**：`~/.im-standin/`、`*.db`、日志、`.workbuddy/`、`.zcode/`——已在 `.gitignore`，
  禁止 `git add -f` 绕过。

示例数据只来自 `dsh-plugin/scripts/demo/fixture.mjs` 的虚构人物；示例域名用
`your-gateway.example.com`。误提交凭据：**先去吊销那个 key**，再处理历史——只删 commit 不够。
`bash scripts/gate.sh --quick` 里的 `secrets` 扫描会拦常见凭据形状；不要 `--no-verify` 绕过。
面向人类的完整清单与误提交处置见 `CONTRIBUTING.md §不要带进来的东西`。

## 设计铁律（改代码前先背下来）

1. **不监听任何端口。** 面板走 DSH 的同源路由，后端是宿主进程内的 Node 模块。想加端口 = 架构回退，
   需要新 ADR 说明为什么翻案（`docs/decisions/implemented/0001-zero-port.md`）。
2. **值守会话 60 秒一拉，发现/列表刷新下限 10 分钟；群默认不拉。** 快车道只拉既有候选
   （`poll.fast_sec`，0 可关）；慢车道管会话发现，间隔不得小于 10 分钟。群只有 `timer=1`
   才进轮询。成本模型见 `docs/architecture/02-data.md §拉取节奏`。
3. **屏蔽即不同步。** `blocked` 的会话定时、点开、手动三条路都不进，只在 `candidates()` /
   `pollChat()` 收口判断。
4. **运行时零第三方依赖。** 插件后端只用 Node 标准库，前端只交构建产物 `lib/client.js`；
   dev 工具可以加，但不能让「clone 下来就能跑」变复杂。
5. **消息正文只在本机。** 不上传、不进日志；插件不读模型凭据，也不回传。
6. **承认平台差异。** 企微没有消息 ID、钉钉不登录读不了——写进 `references/`，不假装适配过。
7. **迁移只放宽。** 补字段的默认值不得改变存量会话的行为（群补 `timer=-1`，不是 0）。
8. **插件只做确定性搬运，判断与维护归 agent。** DSH 形态下插件的全部职责就这几件：消息轮询 /
   拉取 / 去重、命中唤醒、新消息到达时打断在飞 turn、同一会话的续跑、会话绑定与面板上的
   「新建会话」入口、把消息与文件路径交给 agent、把 agent 写好的文件原样读给面板。
   归纳、判断、排优先级、写摘要、维护画像这类需要理解内容的事，一律由 agent 按 `SKILL.md`
   在自己的会话里完成，插件不代做、不代写、不解析。否则同一套规则会在 Node 与 prompt 里长两遍，
   两边判断还不一致。先例：`docs/decisions/implemented/0004-profile-file-and-pointers.md`。

## 开发流程

1. **先 spec 后代码。** 非平凡改动（新接口 / 表列 / 配置键 / 状态机 / 用户可见交互 / 跨两个以上文件）
   先写 `docs/specs/active/NNNN-短名.md`（模板 `docs/specs/_template.md`，编号规则见
   `docs/specs/README.md`）；非平凡再配 `-plan.md`，一步一验证。
2. **同 commit 改契约。** 动路由 / 表 / 配置键，必须同时改 `docs/specs/contracts/` 对应文件，否则对账测试红。
3. **实施中改主意先改 spec**，不留两套方案；验收逐条对勾后 `git mv` 进 `docs/specs/archive/` 并登记。
4. **提交前**：`bash scripts/gate.sh --quick` 全绿（秒级；`scripts/install-hooks.sh` 一次性接上钩子）。
5. **收尾**：`PROGRESS.md` 更新断点 + 当日 `docs/implementation/log/YYYY-MM-DD.md`；
   用户可见行为变了改 `CHANGELOG.md`；架构取舍变了补 `docs/architecture/` + ADR。
6. **发版**：全量 `bash scripts/gate.sh`，按 `docs/implementation/runbooks/publish.md` 走。

## 版本号管理

- **真源只有一个**：`dsh-plugin/package.json` 的 `version`。git tag、`market/index.json`、
  `CHANGELOG.md` 顶部版本小节都必须与它一致（`tests/test_docs.py` 与发版 CI 会比对）。
- **没发版不涨号**：日常改动只往 `CHANGELOG.md` 的 `## 未发布` 追加小节，`version` 保持
  上一个已发布版本；只有发版提交才动它。
- **SemVer**：`MAJOR` = 对外契约不兼容（API / `state.json` / 配置键删改）；`MINOR` = 向后
  兼容的新功能；`PATCH` = 只修 bug、文案、样式。1.0 前用 `0.MINOR.PATCH`，不兼容改动进 MINOR。
- **发版一次做齐**：未发布小节改成 `## X.Y.Z — YYYY-MM-DD` → 改 `package.json` →
  全量 gate 全绿 → 提交 `chore(release): vX.Y.Z` → 打 `vX.Y.Z` tag 推送 → CI 校验版本
  一致并发布 → `npm view` 确认存在后，再单独提交 `market/index.json` 指向该版本。
- **tag 只打已发布版本**：不移动、不复用已发布 tag；出问题发新 PATCH，不改写历史。
- 文档不写版本快照（时效指针只放 `docs/implementation/PROGRESS.md`）；spec 的「版本」写目标版本。

## 格式要求

- **commit**：Conventional Commits，一个 commit 一件事，如 `fix(poller): 企微正序导致取到最旧一条`；
  正文写「现象 → 根因 → 改法」，不复述 diff，不夹带无关格式化。
- **代码**：`.editorconfig` 为准（UTF-8、LF、2 空格，Python 4 空格 / 100 列）；
  运行时零第三方依赖（Python 与插件 Node 均只用标准库）。
- **文案**：文档、注释、提交信息用中文；标识符用英文。用户可见文案不出现 `imid` 等内部 ID。
- **文档**：活文档就地改写（禁「追加」小节与「此前：」状态链）；新活文档必须在
  `scripts/doc_budgets.json` 登记行数上限；互引写仓库相对全路径 + `§标题`，不写行号。
- **平台事实**：CLI 行为 / 字段差异写进 `references/<平台>.md`，不写进引擎；没实测的不写成已支持。

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
