# 0005 右侧栏停靠 · 实施计划

> 关联: `docs/specs/archive/0005-sidebar-dock.md`
> 结果: 5 步全部完成（0.8.0）；3080 实测停靠、跳转、关闭/重开，全量测试 98 通过
> 原则：先跑通「席位开 tab」，再收布局，最后补退化与文档。

## 步骤

1. **面板拆挂载**
   - `web/panel.js`：`mount` 加 `mode: "dock"`（无席位/遮罩/关闭，铺满宿主）；
     新增 `mountSeat`（入口 + 角标 + 60s status）与 `mountDock` 包装。
   - 验证：独立预览页 `standalone.html` 仍走 `mount()`，浮层正常。

2. **注册右侧栏**
   - `lib/client.template.js`：`sidebarRightTabs.register` + keyed
     `sidebar.right.pane.tab`；页体挂 `mountDock`；席位挂 `mountSeat`。
   - `package.json` 的 `dsh.client.inject` 声明 sidebar / sidebar-right。
   - 验证：3080 重启后点席位，右侧栏出现标签页，日志 `dock tab registered`。

3. **去会话跟随**
   - `openSession` 后延时补 `openTab(kind)`；停靠态 `goSession` 不再关面板。
   - 验证：示例对象 A会话点「去会话」→ 主界面切换，右侧栏仍停靠。

4. **退化**
   - 3 秒等不到 `sidebarRightTabs` / `sidebarRight` → 原浮层席位；
     日志 `using overlay fallback`。
   - 验证：临时改名服务无法真测，代码路径检查 + 老版本 DSH 手测。

5. **截图与文档**
   - `shot-dsh.mjs` 先开右侧栏再拍；README 换成停靠说明；spec 归档、CHANGELOG、
     PROGRESS、当日 log、architecture 01 同步。
   - 验证：`bash scripts/gate.sh --quick` + `python3 tests/run_tests.py` 全绿。

## 回滚点

- 提交拆分：①panel 挂载模式 ②client 注册 ③截图/文档。
- 回滚只需把席位组件换回 `mount()`；tab 注册无持久化副作用（localStorage 的
  旧 tab 记录由 DSH 自己在类型消失后显示「无法查看」并允许关闭）。
