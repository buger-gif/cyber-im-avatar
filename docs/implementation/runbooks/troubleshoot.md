# 排障：面板与插件后端

> 按症状走。skill 形态（监听脚本）的故障在 `references/troubleshooting.md`，这里只管 DSH 插件。
> 顺序建议：先跑面板「体检」按钮，再看 `~/.dsh/web.log` 的 `[im-standin]`。

## 症状 A：侧边栏没有「IM 值守」

1. 插件装在哪个 profile？`dsh plugin --profile web list`。headless 等无 webServer 的 profile
   里插件**故意不做事**（`docs/architecture/01-shape.md §三层转发校验`）。
2. 宿主没注册成功：DSH 启动日志里搜 `[im-standin]`，没有 `ready` 就看报错。

## 症状 B：面板 401 / 白屏

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| 重启 DSH 后旧标签页 401 | token 是进程启动时随机生成的，重启就换 | **刷新页面**，这是预期行为 |
| 换了浏览器 / 隐身窗口 401 | 同上，token 没注入到这个会话 | 用带 `?token=` 的启动日志链接开一次 |
| 面板加载了但接口全 401 | 页面里的 `IM_STANDIN_TOKEN` 注入缺失 | 查 DSH 版本是否支持 `webserver/index-inject` |
| 白屏、控制台一堆 404 | `lib/client.js` 没重建 | `python3 scripts/build_client.py` 后刷新 |

## 症状 C：插件没启动 / 一直不轮询

```bash
cd dsh-plugin
grep '\[im-standin\]' ~/.dsh/web.log       # 应有 ready; state = ~/.im-standin/state.json
lsof -nP -iTCP -sTCP:LISTEN                # 只应有 DSH 的 3080；多出来就是有人开了端口
```

- **没有 ready**：`lib/index.js` 语法/导入错误，或插件未装进当前 profile；重启 DSH 看日志。
- **`state.json` 损坏**：`State.load()` 会先读 `state.json.bak`；两份都坏时先从 `.bak` 手工恢复，
  不要删文件了事。
- **配置写坏**：`node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.im-standin/state.json','utf8'))"`。
- **两个宿主同时跑**：桌面 app 与 3080 同时开值守会抢会话/互覆 state；只留一个。

## 症状 D：待回一直是 0 / 拉不到消息

按顺序核对（面板「体检」页或 `GET /api/status`）：

1. `running` 是不是 false（被 `/api/pause` 暂停了）。
2. `platforms` 里有没有该平台；没有 → 装对应 CLI 并重跑 bootstrap，或检查 `env.json`。
3. 该会话是不是被屏蔽了：`GET /api/chats` 看 `blocked`。「设置 → 值守范围 → 已屏蔽的会话」能找回来。
4. 私聊：只有 `watching=1` 才进定时轮；点开会话补拉不受此限。
5. 群：默认**不拉**。要它进轮询必须 `timer=1`（面板上勾「定时检测 @我」）。
6. 冷却：20 秒内刚拉过会 skip，`poll.last_result` 里有 `xxxs 内刚拉过`。
7. 间隔：`poll.interval_min` 下限 10 分钟，改小会被夹回去，不是 bug。
8. 本地每会话只留 10 条；更早的在线上，不在本地。

## 症状 E：消息发不出去

- 面板手动发送失败会直接回 `reason`；先看 CLI 授权，再按 `references/troubleshooting.md` 查字段漂移。
- 插件不记发送历史（没有 `sends` 表）；成功与否以平台返回为准。
- 涉及钱 / 承诺 / 对外群被拦：风险拦截在 skill 铁律里，agent 会在值守会话里停下等本人；这是设计行为。

## 症状 F：命中了但 agent 不起 turn

1. `status.dsh.dsh_ready` 是否为 true（`sessionController`/`sessions` 是否注入成功）。
2. `status.instances[].turn_state`：`running` 且长时间不动 → turn 超时（`dsh.timeout`，默认 600s）
   或另一个 DSH 宿主持有会话写锁（错误 `session_locked_other_host`）。
3. `status.errors` 里看 turn 失败原因；`workspace_missing` 表示显式绑定的目录不存在。
4. 会话复用：显式工作区未登记进 DSH 也会先恢复旧 `dsh_session`；cwd 漂移才会新建。
5. skill 路径：`doctor` 的「skill 路径」检查，缺了 agent 仍能回但拿不到平台细节。

## 症状 G：agent 报 PermissionError /「监听没能重挂」

- 多半是壳内 turn 去跑了 skill 的 `listen_cli` 或 `bootstrap.py`。DSH 的沙箱是
  按会话的 `workspace-write`（边界 = 会话 cwd），`~/.im-standin` 在工作区外，
  chmod / 写水位会被拒。
- 插件已经负责轮询与水位：首轮唤醒 prompt 带「运行形态：DSH 插件壳」，后续只追加消息行，要求
  **不要挂监听 / 不重挂**。看会话里 agent 是否无视了这条；必要时在值守会话里再
  说一句「监听由插件管，不要挂」。独立 skill 形态请在非沙箱终端挂监听。

## 还是不行

- 把 `~/.dsh/web.log` 的 `[im-standin]` 尾部 + `/api/status` 输出贴给下一个会话，并写进当日 log。
- 修好了：把根因补进本文件对应症状下（一两行），别只写在提交信息里。
