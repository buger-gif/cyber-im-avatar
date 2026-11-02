# 0007 实施计划：外观跟随 DSH 主题

> 一步一验证。每步做完先跑该步的验证命令，再动下一步。

## 1. 写 spec 与登记编号

- [x] `docs/specs/active/0007-follow-dsh-theme.md`
- [x] `docs/specs/README.md` 已登记（0009 被并行 spec 占用，下一个号 0010）
- 验证：`python3 scripts/verify_docs.py`

## 2. 面板去掉皮肤，改两套配色

- [x] `web/panel.js` 删除 `SKINS`、皮肤选择器、`data-skin`、`data-nav=rail`；
- [x] `.ims-root` 浅色变量保留，新增 `body[data-ds-dark-theme]` /
      `html[data-ds-theme-source=dark]` 的深色变量覆盖；
- [x] 设置页删「外观」卡，头部齿轮按钮标题改「设置」；
- [x] 删除 `curSkin` / `applySkin` / `setSkin`、URL skin 解析、导出 `skins`；
- [x] 席位挂载不再读 `config.ui.skin`。
- 验证：`node --check web/panel.js`，`grep -n "data-skin\|SKINS\|ui.skin" web/panel.js` 无输出。

## 3. 配置退役 ui

- [x] `service/config.py` 删除 `DEFAULTS.ui`，`_upgrade()` / `_strip_retired()` 丢 `ui`；
- [x] `web` 与 fixture 不再发 `ui`；
- [x] 测试：`test_stdio.py` 改写 `poll.interval_min`；`test_polling.py` 加 `ui` 退役断言。
- 验证：`cd dsh-plugin && python3 -m unittest discover -s tests -v`。

## 4. 文档与产物

- [x] 契约 03 删 `ui.skin`，补 0007 退役说明；
- [x] `dsh-plugin/README.md` 设置页说明与「四套皮肤」整节改为「外观跟随 DSH」；
- [x] `CHANGELOG.md` Unreleased 补一条；`PROGRESS.md` 改断点；当日 log 追加事实；
- [x] `python3 scripts/build_client.py` 重建 `lib/client.js`。
- 验证：`bash scripts/gate.sh` 全绿。

## 5. 视觉验证

- [x] 起 DSH（`./scripts/start-dsh.sh --restart`），浅色下看面板；
- [x] DSH 设置切深色，确认右侧栏面板与侧边栏席位都变深且无需刷新；
- [x] 切回浅色，确认回浅色。
- 验证：截图或人工确认；不新增截图入库。
