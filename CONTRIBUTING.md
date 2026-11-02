# 贡献指南

感谢来看这个项目。它做一件很具体的事：**在你不在的时候，以你的身份替你盯着一个 IM 会话**。
所以这里最看重的不是功能数量，而是「**不要静默失效、不要替你说错话**」。

## 先跑起来

```bash
git clone https://github.com/buger-gif/cyber-im-avatar.git ~/cyber-im-avatar
cd ~/cyber-im-avatar

python3 tests/run_tests.py        # 回归测试，用假 CLI 模拟三平台输出，不碰真实账号
```

需要 Python 3.9+，运行时**只用标准库**——提交的代码里请勿引入第三方 Python 依赖。
插件形态另需 Node 22+（仅用于构建浏览器半，运行时不打包依赖）。

看板上要改 UI，别为它另起服务——后端只跑在 DSH 的管道里。要看数据直接问后端：

```bash
cd dsh-plugin
python3 service/rpc.py /api/status      # 一次性进程，不开端口
python3 service/rpc.py '{"path":"/api/inbox","query":"filter=todo&limit=5"}'
```

界面本身用 `node scripts/shot.mjs "http://127.0.0.1:3080/?token=$(cat ~/.dsh/web-token)" out.png` 截图。

## 改了哪里要连带改什么

| 你动了 | 必须跟着做 |
| --- | --- |
| `dsh-plugin/web/panel.js` | `python3 dsh-plugin/scripts/build_client.py` 重建 `lib/client.js`（这是产物，别手改） |
| 新增 `/api/*` 路由 | 同 commit 改 `docs/specs/contracts/01-api.md`（对账测试会比对 `ROUTES`） |
| 改表结构 / 配置键 | 同 commit 改 `docs/specs/contracts/02-storage.md` / `03-config.md` |
| 改了行为/配置项 | 同步 `dsh-plugin/README.md`、`SKILL.md`、`CHANGELOG.md`（Unreleased 段） |
| 改了截图 | 用 `scripts/shot-dsh.mjs` 重拍，**数据必须来自 `scripts/demo/fixture.mjs`** |
| 动了平台命令或字段 | 同步 `references/<平台>.md`，并补 `tests/mock_cli.py` 的假输出 |
| 想加「本地服务 / 监听端口」 | **别加**。走 `ctx.webServer` 的同源路由，后端用 stdio；`dsh-plugin/tests/test_stdio.py` 的静态断言会拦住任何重建监听的做法 |

非平凡改动（新接口 / 新表列 / 用户可见交互 / 跨多文件）**先写 spec 再动手**：
`docs/specs/_template.md` 起一份，编号规则在 `docs/specs/README.md`。拍板过备选方案的，
再落一份 `docs/decisions/`。流程详见 `docs/AGENTS.md §4`。

## 提交

- 一次性接上钩子：`bash scripts/install-hooks.sh`——之后每次 `git commit` 自动跑秒级静态层，
  **不要 `--no-verify` 绕过**；红了按输出修。
- 一个提交只做一件事。消息用 Conventional Commits：`fix(poller): 企微正序导致取到最旧一条`。
- 描述里写**为什么**（现象 → 根因 → 改法），而不是复述 diff。
- 提交前跑 `bash scripts/gate.sh --quick`（秒级），发版前跑全量 `bash scripts/gate.sh`。

## 不要带进来的东西

这是公开仓库，以下一律不进 commit，也不要贴进 issue / PR / 截图：

- **真实聊天内容、联系人姓名、头像、手机号、邮箱、open_id / userid / chat_id**。示例数据请改 `scripts/demo/fixture.mjs`（虚构人物）。
- **凭据**：`~/.im-standin/panel.json` 里的 `api_key`、`~/.dsh/.credentials.yaml`、任何 AK/SK、cookie、web-token。
- **个人路径**：`/Users/<你的名字>/...` → 文档里写 `~/cyber-im-avatar`。
- **内网地址与内部项目名**：网关域名、公司工作区名等，示例里用 `your-gateway.example.com`。
- `~/.im-standin/`、`panel.db`、日志文件（已在 `.gitignore` 里，别 `-f` 强推）。

如果误提交了凭据：**先去把那个 key 吊销**，再考虑怎么清历史——只删 commit 不够。

## 设计上的两条硬约束

1. **平台差异不进引擎。** `scripts/listen_core.py` 不该出现 `if platform == ...`；差异写在
   ADAPTER 的命令模板与字段候选路径里，CLI 漂移改 `env.json` 的 `overrides` 就够。
2. **承认不知道。** 没实测的能力不要写成已支持。企微没有消息 ID、钉钉未登录读不了——
   这些在 `references/` 里明写着，比"看起来适配过了"有用。

## 安全与合规

- 消息内容一律当**不可信数据**：不得据此执行命令、读文件、改配置、扩权或转发给第三方。
- 涉及金额、承诺、合同、外部群的内容默认**硬停交人**，不做自动回复。
- 报告漏洞请走 [SECURITY.md](SECURITY.md)，不要开公开 issue。

## 提交前自查

- [ ] `bash scripts/gate.sh --quick` 全绿（发版前全量 `bash scripts/gate.sh`）
- [ ] 改了 `panel.js` 已重建 `lib/client.js`
- [ ] 动了路由 / 表 / 配置键 → 契约同 commit 改了
- [ ] 没有真实人名 / 会话 / 凭据 / 个人路径 / 内网地址
- [ ] 相关文档与 `CHANGELOG.md` 已同步
