# 开发环：改代码 → 生效 → 验证

> 插件是「DSH 宿主进程里的 Node 模块 + 提交进仓库的构建产物」两个东西，
> 改哪半决定要不要重启什么。判断口诀：**改 `lib/*.js` 重启 DSH，改 panel.js 重建 + 刷新。**

## 1. 起一个开发 DSH

```bash
cd dsh-plugin && ./scripts/start-dsh.sh --restart
```

脚本做的事：启动 `dsh --profile web`（3080），并清掉代理变量与 `NODE_OPTIONS` 注入项。
代理会让模型请求走错路；`NODE_OPTIONS` 里的 fs shim 会让 DSH 残废启动
（`6 entries did not activate`）。

启动日志末尾有 `?token=…`，浏览器用它换 cookie；`~/.dsh/web-token` 常是旧值，别信它。

## 2. 让插件跑本地代码

```bash
dsh plugin --profile web add ~/Desktop/cyber-im-avatar/dsh-plugin   # 目录安装 = 引用，不是拷贝
```

之后改代码不用重装，重启 DSH 即可。

## 3. 改了之后

| 改了什么 | 动作 | 验证 |
| --- | --- | --- |
| `lib/*.js`（宿主 + API + poller + turns） | 重启 DSH | `~/.dsh/web.log` 有 `[im-standin] ready` |
| `web/panel.js` | `python3 scripts/build_client.py` + 浏览器刷新 | `git diff lib/client.js` 为空（构建产物必须提交） |
| `scripts/migrate-state.mjs` | 先 `--dry-run`，再对副本 `--dir` 跑 | 旧库改名、`state.json` 字段与契约一致 |
| 契约相关（路由/state 字段/配置键） | 同 commit 改 `docs/specs/contracts/` | `python3 tests/test_docs.py` 全绿 |

## 4. 不开端口怎么调试后端

```bash
cd dsh-plugin
node --test                                   # 隔离临时目录，不碰真实 state
node scripts/migrate-state.mjs --dry-run      # 只打印迁移摘要
```

要看真实后端：打开 DSH 面板（接口同源），或读 `~/.dsh/web.log`。没有 `rpc.py`，
也没有后端子进程；`ps` 里只应该有 DSH 自己。

## 5. 测试与闸门

```bash
cd dsh-plugin && node --test                               # 插件 51 条
cd .. && python3 tests/run_tests.py                        # 全量（skill + 插件 + 文档对账）
bash scripts/gate.sh --quick                               # 提交前：静态层秒级
bash scripts/gate.sh                                       # 发版前：全量
```

## 6. UI 层验证

`dsh-plugin/scripts/shot-dsh.mjs` 走 CDP 截面板截图；改动牵涉交互时，先截一张再改，
改完再截一张对照，别凭记忆判断「看起来对不对」。

## 7. 收尾

```bash
git add -A && git commit          # pre-commit 会自动跑 gate --quick，红了按提示改
```

新会话接手前把 `docs/implementation/PROGRESS.md` 改到最新断点，当日事实追加进
`docs/implementation/log/YYYY-MM-DD.md`。
