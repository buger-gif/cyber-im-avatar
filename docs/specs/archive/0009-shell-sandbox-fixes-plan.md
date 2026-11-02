# 0007 壳内不挂监听 + 打断续会话 · 实施计划

> 关联: `docs/specs/archive/0009-shell-sandbox-fixes.md`

1. `turns.build_prompt`：加「插件负责轮询，不要 listen_cli/bootstrap/重挂」；
   指路改为「回复风格/平台差异/铁律（跳过监听步骤）」。加断言。
2. `dshrun.start`：子进程 env 注入 `IM_STANDIN_SHELL=1`。
3. `TurnManager.wake`：打断后先落 `old.session_id`，再 `_spawn`；
   加「首轮未落库被打断仍续用同 session」用例。
4. `SKILL.md`：加壳内分支；troubleshoot 记录 PermissionError 的成因与处理。
5. 测试 + gate；重启 3080 做一次壳内验证，确认不再出现监听报错。

回滚：第 1/2/4 可单独撤；第 3 是纯修复，建议保留。
