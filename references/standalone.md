本文件只在**独立 skill 形态**读：载荷里没有「运行形态：DSH 插件壳」标记时就是独立 skill 形态。
**DSH 插件壳内不要读它**——插件已负责监听、水位与唤醒。
载荷开头带 `/cyber-im-avatar` 且含「运行形态：DSH 插件壳」时属于壳内。

**目录**

- 快速开始（四步）
- 标准闭环
- 监听脚本公共参数
- 平台差异与字段漂移：改配置，不改代码
- 权限标准：只申请「自己真会调」的那几项
- 出故障了：先体检，再查索引
- 记忆：越用越像，越用越懂
- 文件结构（skill 安装包）

## 快速开始（四步）

以下命令都在 skill 根目录执行。

```bash
# 0. 体检（30 秒，全绿再往下；任何 fail 都不要挂监听）
python3 scripts/doctor.py

# 1. 环境自适配 + 学本人风格（首次必跑）
python3 scripts/bootstrap.py
python3 scripts/bootstrap.py --find feishu "张三"       # 取得目标 chat_id，登记并建记忆文件骨架
python3 scripts/bootstrap.py --person-path feishu ou_yyy  # 取/建该人的人物档案（跨会话共用）
python3 scripts/bootstrap.py --learn-style feishu --chats oc_xxx
#    → 只从显式选择的会话抓本人发言，脱敏后写 self_corpus.jsonl
#    → agent 只提炼风格写 persona.md，不复制事实、凭据或聊天正文

# 2. 验证目标私聊通路
python3 scripts/bootstrap.py --selftest feishu <chat_id>    # 3 秒自检

# 3. 挂监听（后台任务，等命中或 55 分钟缓存续期）
#    连续 3 小时没有新消息命中会退出 4（值守结束，不重挂）
UNTIL=$(python3 -c 'import time; print(int(time.time() + 1800))')
python3 scripts/feishu_listen_cli.py --chat-id oc_xxx --sender ou_yyy --until "$UNTIL"
```

退出码：`0`=命中（stdout 单行 JSON）· `3`=超时未命中或 55 分钟缓存续期（重挂即可）·
`4`=3 小时没有新消息命中（值守结束，**不要重挂、不要开新会话**）· `2`=参数/环境/schema 错误。

## 标准闭环

```bash
# 1. 挂监听 → 命中退出 0，stdout: {hit, chat_id, sender, content, message_id, pending_in_burst}
# 2. 拉上下文（命中往往不止一条）
lark-cli im +chat-messages-list --chat-id oc_xxx --order desc --limit 10 --as user
# 3. 起草前只读 persona.md + 记忆文件（单聊：对方的人物档案；群：工作本 + 要回/被 @ 的
#    那位档案，路径见「记忆文件」），不加载其他会话的事实
# 4. 发出（以本人身份；发送方式以载荷声明为准：默认草稿审批，全自动才直接发）
lark-cli im +messages-send --chat-id oc_xxx --msg-type text --as user --text "$(cat /tmp/reply.txt)"
# 5. 回复发出后：学到长期有效的新事实 → 按「记忆文件」写回（单聊只改人物档案；
#    群才分人物与工作本）；没有就不动
# 6. 重挂监听（水位已自增，勿回拨）；临时值守继续传同一个 --until，不得重置截止时间
#    退出原因是 [cache-refresh]：先按「记忆文件」整理载荷列出的文件，再重挂
#    退出码 4（[idle-exit]）是值守结束：不要重挂、不要开新会话
```

一轮里有多条新消息时**只唤醒一次**，报最新那条，并给出 `pending_in_burst` 提示还有几条。
agent 拉一次上下文就能看到整批，不会把用户连续唤醒 N 次。

- **闲置退出**：默认连续 180 分钟没有新消息命中就退出 `4`，stderr 带 `[idle-exit]`。
  这不是超时要重挂，而是值守结束：**不要重挂、不要新建会话**，向用户报一句
  「3 小时没有新消息，值守已结束」即可。用户之后明确要求继续值守时，重挂才加
  `--new-watch` 重新计时；自动重挂永远不加。
- **55 分钟保温**：退出 `3` 且 stderr 带 `[cache-refresh]` 时，重挂前先按
  「记忆文件」整理载荷列出的文件（该归并就归并，不需要就跳过），不要发消息；
  再按原参数重挂，这次模型调用会续上上下文缓存。

## 监听脚本公共参数

`--chat-id` / `--user-id`（二选一）· `--sender` · `--keyword` · `--interval 60` ·
`--lookback-min 60`（时间窗平台用）· `--init latest|zero` · `--state` · `--timeout` · `--until` ·
`--cache-refresh-min 55` · `--idle-exit-min 180` · `--new-watch`

- `--init latest`：只盯今后新消息（默认）；`--init zero`：立刻对存量最新一条判定，用于验证通路。
- `--user-id`：私聊免查 chat_id。飞书传对方 `ou_...`；企微把 userid 当 chat_id；钉钉走 `--user`。
- `--until`：Unix 时间戳或 ISO 8601 绝对截止时间，与 `--timeout` 互斥；命中后重挂必须沿用原值。
  默认 55 分钟主动退出一次续上下文缓存（`--cache-refresh-min 0` 关闭，退出码 3，重挂即可），
  以及 180 分钟没有新消息命中就退出 4（`--idle-exit-min 0` 关闭，不重挂）。
- `--idle-exit-min`：只认「命中」——被 `--sender` / `--keyword` 过滤掉的、自己发的都不算新消息。
- `--new-watch`：用户重新要求值守时把闲置时钟归零（不碰水位）；自动重挂不要带。

## 平台差异与字段漂移：改配置，不改代码

监听引擎没有平台分支，差异全在 ADAPTER（命令模板 + 字段候选路径）。CLI 命令或字段
改名时，只改 `~/.im-standin/env.json` 的 `overrides.<platform>`，不改代码；引擎支持
`cmd_list_chain` 命令链回退、`f_*` 候选路径、`f_msg_id_compose` 复合指纹、
`f_count`/`f_has_more` 空结果判定、`{begin_time}/{end_time}` 时间窗、`order` 归一与
`self_id_regex` 文本身份提取。

改完必跑：`--probe <平台>` 看真实 JSON → `--selftest <平台> <目标>` 真跑一轮 →
`python3 tests/run_tests.py` 回归。示例与成因见 `references/troubleshooting.md` §C。

## 权限标准：只申请「自己真会调」的那几项

公开分发的 skill 不知道你的应用与历史授权，所以这里只定**怎么决定**，不定固定清单。

1. **按需**：清单只来自脚本真会执行的命令，不来自「以后可能用得上」。
2. **不扩权**：续期只沿用你**已授予**的集合；出现新增权限就拒跑，不静默加。
3. **不代签**：OAuth 必须本人点确认；真要加权限，必须用户显式同意（`--add ... --allow-add`）。

飞书是唯一有 scope 概念的平台：`keep`（默认，续期照搬已授予集合，新增恒为 0）·
`minimal`（首次安装 / 主动收窄，只留必需集 ∩ 应用已开通）· `--scope`（排障，仍需过闸门）。
`lark-cli auth login` 不带 `--scope` 等于 `--domain all`，会全量申请——**一律走 `scripts/reauth.py`**。
请求里出现你没有的权限会 `[block]` 拒跑；`--show-scope` 可在不发请求的情况下预演，新增应为 0。
三种边界情况（应用没开通 / 历史授予 / 平台基础 scope）与自查命令见
`references/troubleshooting.md` §B.3。

必需清单（`scripts/reauth.py` 的 `FEISHU_REQUIRED`；加功能才加行，并说明哪个命令要用）：

| scope | 用途 |
|---|---|
| `im:message:readonly` | 读历史消息 `+chat-messages-list` |
| `im:message.p2p_msg:get_as_user` / `im:message.group_msg:get_as_user` | 读单聊 / 群消息 |
| `im:message.send_as_user` | 以本人身份发消息 |
| `im:chat:read` / `im:chat.members:read` | 查会话、读群成员（防回环） |
| `im:feed.shortcut:read` | 最近会话（语料抓取的降级路径） |
| `contact:user:search` / `contact:user.basic_profile:readonly` | 按名字找人 |
| `auth:user.id:read` | 取本人 `open_id`（平台基础 scope） |
| `offline_access` | 换 refresh token，否则 2 小时一续 |

企业微信 / 钉钉没有 scope 概念：企微在管理后台勾机器人能力，钉钉在开放平台配权限点；
脚本对这两个平台不申请、不修改，`doctor` 也不做 scope 检查——不假装有。

红线：不用 `--domain all` / `--recommend`；不悄悄 `--allow-add`；不把授权链接、
`device_code`、scope 清单发到群聊或第三方；不编造平台权限能力。

## 出故障了：先体检，再查索引

任何异常都先跑这一条，别猜：

```bash
python3 scripts/doctor.py                          # CLI/版本/授权/配置/水位 全查
python3 scripts/doctor.py feishu --chat-id oc_xxx  # 附带 3 秒真实通路自检
python3 scripts/doctor.py --check-update           # 查各 CLI 是否有新版
python3 scripts/doctor.py --json                   # agent 解析用（ok=现在能不能用）
```

每一项 fail 都会打印 `→ 修复:` 一行（可直接抄）和 `→ 手册:` 锚点。
CLI 体检的 warn（如有新版本）只提醒、不阻塞；体检只查启用的平台；通路自检对传输层
失败自动重试一次。

退出码：`0`=可用 · `2`=指定平台或全部平台不可用。

完整分诊表与修复步骤在 **`references/troubleshooting.md`**（§0 分诊 → 按症状跳转 → §K 回归）。
高频入口：CLI/版本 §A · 授权到期 §B · `SCHEMA_MISMATCH` §C · 拉不到消息 §D ·
命中异常 §E · 进程消失 §F · 发不出去 §G · 内容硬停 §H。

四条硬规矩：

1. **fail 不挂监听**——"能拉取但字段全空"会静默失效，不会报错。
2. **升级 CLI 后必须回归**：`--probe` → `--selftest` → `tests/run_tests.py`。
3. **授权类故障要引导用户**：飞书直接 `scripts/reauth.py feishu` 发卡片（点一下即可，
   不用扫码）；其它平台把设备流链接/短链发给用户。**不要在命令里死等 OAuth 回调**。
4. **授权只续期、绝不扩权**：`lark-cli auth login` 不带 `--scope` 等于 `--domain all`；
   一律走 `scripts/reauth.py`（默认 keep），规则见上文「权限标准」。

## 记忆：越用越像，越用越懂

画像 / 语料 / persona 的路径与用途见 `SKILL.md` §记忆；这里只给补条目、归档与删除数据的 CLI。
`env.json` → `targets` 只存会话目标索引（单聊的 `profile_file` 也指向人物档案）。

```bash
python3 scripts/bootstrap.py --note feishu "示例群" "……"             # 群工作本补一条
python3 scripts/bootstrap.py --person-note feishu ou_xxx "对价格敏感"  # 人物档案补一条
python3 scripts/bootstrap.py --delete-data --yes   # 删除画像、语料、persona 和水位
```

## 文件结构（skill 安装包）

```
SKILL.md                 值守时的常驻规则（两种形态都读）
references/standalone.md 本文件：独立形态的安装 / 监听 / 授权 / 排障 / 记忆 CLI
README.md                安装方式、两种形态与成本模型
CHANGELOG.md             版本记录
LICENSE                  MIT
references/
  {feishu,wecom,dingtalk}.md   平台差异与坑位（按需只读一份）
  troubleshooting.md           故障索引：分诊表 → 症状 → 修复 → 回归
  standalone.md                本文件：独立形态手册
scripts/
  data_guard.py          私有权限 / 语料脱敏 / 安全诊断
  doctor.py              体检 + 自愈引导（CLI/版本/授权/配置/水位/通路）
  reauth.py              免扫码重新授权（飞书：bot 发授权卡片；企微/钉钉给正确路径）
  bootstrap.py           环境探测 / 学风格 / 找目标 / 记忆文件（单聊人物档案、群工作本）/ probe / selftest / 删除数据
  listen_core.py         通用监听引擎（无平台分支）
  {feishu,wecom,dingtalk}_listen_cli.py  三平台适配器
tests/
  run_tests.py           自检（假 CLI，不碰真实账号）
  mock_cli.py            三平台假 CLI
```

仓库开发结构（`AGENTS.md` / `docs/` / `dsh-plugin/` / `tests/test_docs.py` 等）不在 skill 包内，
见仓库根 `AGENTS.md`。
