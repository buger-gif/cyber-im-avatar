# runbooks 索引

> 每篇讲**一件具体的事**：按步骤能做完，坑位写在步骤旁边。
> 「为什么这样设计」不在本目录，去 `docs/architecture/`。

## 任务速查

| 要干什么 | 读哪 |
| --- | --- |
| 本地改代码 → 看到 UI 生效 → 跑测试 | `docs/implementation/runbooks/dev-loop.md` |
| 发 npm / 打 tag / 更新自托管插件市场索引 | `docs/implementation/runbooks/publish.md` |
| 面板白屏 / 401 / 不轮询 / 拉不到消息 | `docs/implementation/runbooks/troubleshoot.md` |
| 查平台 CLI 的字段与授权坑 | `references/`（skill 侧共用，改这里要同步 `SKILL.md`） |

## 约定

- runbook 里出现的命令都假设在**仓库根**执行，需要 `cd` 的块会写明。
- 每篇 runbook 结尾不加「总结」；发现步骤过期直接改，别在文末追加勘误。
- 修了一个会复发的坑：先改 runbook，再收尾（`docs/AGENTS.md §6`）。
