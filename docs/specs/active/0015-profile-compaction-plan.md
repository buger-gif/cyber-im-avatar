# 0015 实施计划

> 一步一验证；每步完成后勾掉再进下一步。

1. [x] `profiles.js`：新增 `SOFT_PROFILE`、`archive()`、history 路径。
2. [x] `turns.js`：prompt 常驻维护规则 + 超软上限整理指令；`applyProfile` 缩小时归档。
3. [x] Node 测试：prompt 提示、缩小时归档、超 12KB 拒写、history 权限。
4. [x] `bootstrap.py`：`--compact` 去重 / 归档 / `--dry-run`；`--note` 自动整理。
5. [x] Python 测试：30 条历史结论整理、去重、dry-run、history 内容。
6. [x] 文档：`SKILL.md` 画像节、`README.md`、`CHANGELOG.md`、`PROGRESS.md`、当日 log。
7. [x] 全量测试 + `gate.sh --quick`，重新 bundle + 全局 skill，spec 验收对勾。
