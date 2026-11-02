# 0008 实施计划：只保留侧边栏停靠

> 一步一验证。

## 1. 面板去掉浮层

- [x] `mount()` → `mountPanel()`：删席位/遮罩/关闭按钮/`S.open`；
- [x] 删 `.ims-scrim`、浮层定位、`--shadow`、`data-mode=overlay`；
- [x] `mountDock()` 直接调 `mountPanel()`，导出只留 `mountDock` / `mountSeat`。
- 验证：`grep -n "scrim\|S.open\|overlay" web/panel.js` 为空；`node --check`。

## 2. 去掉浮层回退

- [x] `client.template.js` 删 `mountOverlaySeat()` 与 3 秒定时器；
- [x] 席位立即注册，右侧栏标签等服务就绪后注册；
- [x] 缺右侧栏服务时只 toast，不挂浮层。
- 验证：`grep -n "mountOverlay\|fallback" lib/client.template.js` 为空。

## 3. 预览页与产物

- [x] `scripts/demo/standalone.html` 改 `mountDock`，宿主 100vh；
- [x] `python3 scripts/build_client.py`；`node --check lib/client.js`。
- 验证：独立预览页铺满视口，无浮层。

## 4. 收尾

- [x] 契约无变化（无接口/表/配置键改动）；
- [x] `CHANGELOG.md` / `dsh-plugin/README.md` / `PROGRESS.md` / 当日 log；
- [x] `bash scripts/gate.sh` 全绿。
