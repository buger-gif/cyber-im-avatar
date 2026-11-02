# 0008 只保留侧边栏停靠

> 状态: 已验收
> 编号: 0008
> 版本: 0.8.0
> 关联: `docs/specs/archive/0005-sidebar-dock.md`、`dsh-plugin/lib/client.template.js`、`dsh-plugin/web/panel.js`

## 背景

0005 把面板从居中浮层改成 DSH 右侧栏标签页，但保留了浮层作为老版本 DSH 的回退：
`client.template.js` 在右侧栏服务不可用时 `mountOverlaySeat()`，`panel.js` 的
`mount()` 也还带着遮罩、关闭按钮、Esc 关闭和 `position:fixed` 的浮层样式。
两套形态让面板的 DOM、快捷键和生命周期都要分叉维护，而实际在用的只有右侧栏。

## 目标与非目标

- 目标：删掉浮层形态，面板只以 DSH 右侧栏标签页存在；侧边栏底部席位只负责打开
  右侧栏；老 DSH 没有右侧栏服务时，席位给出准确提示，不再退回浮窗。
- 非目标：
  - 不改右侧栏标签注册方式与「去会话」；
  - 不改面板内容、接口、配置、轮询；
  - 不做新的入口（不新开端口、不加浮层、不改 DSH）。

## 方案

### 1. 面板只保留停靠形态（panel.js）

- `mount()` 改为 `mountPanel()`：不再创建席位、遮罩、关闭按钮，也不再有
  `data-mode=overlay`、`position:fixed` 与 `S.open` 开关；面板铺满标签页宿主。
- 删除 `.ims-scrim`、浮层定位样式、`.ims-panel.open`、`--shadow`；
  Esc 只从会话详情退回列表，不再关闭面板。
- `mountDock()` 直接调用 `mountPanel()`；导出只留 `mountDock` / `mountSeat`。
- 独立预览页 `scripts/demo/standalone.html` 改用 `mountDock`，宿主给 100vh。

### 2. 去掉浮层回退（client.template.js）

- 删除 `mountOverlaySeat()` 与 3 秒回退定时器。
- 席位（`sidebar.footer.action`）只依赖 `slots`，在 `apply()` 里立即注册；
  右侧栏标签（`sidebar.right.pane.tab`）等 `sidebarRightTabs` / `sidebarRight`
  就绪后再注册，缺服务时只记日志、不挂浮层。
- 席位点击仍走 `openDock()`：返回 `unavailable` 时 toast「这个 DSH 版本没有右侧栏服务」。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 保留浮层作为老 DSH 回退 | 用户明确要求只留侧边栏；两套形态的维护成本高于兼容收益 |
| 缺右侧栏时完全不挂席位 | 用户会以为插件没装；席位 + 准确提示更诚实 |
| 把席位改成新浮层入口 | 又绕回被否掉的架构 |

## 影响面

- 代码：`dsh-plugin/web/panel.js`、`dsh-plugin/lib/client.template.js`、
  `dsh-plugin/scripts/demo/standalone.html`；
- 构建：重建 `lib/client.js`；
- 契约：无接口 / 表 / 配置键变化；
- 用户可见：不再出现居中浮窗与关闭按钮；面板只活在右侧栏；
- 兼容：没有右侧栏服务的 DSH 只剩席位提示，不提供面板。

## 验收

- [x] 点侧边栏席位 → 面板在右侧栏打开，主界面不被遮罩；
- [x] 面板里没有关闭按钮，Esc 只从会话详情退回列表；
- [x] 代码里不存在 `mountOverlaySeat` / `.ims-scrim` / `data-mode=overlay`；
- [x] `bash scripts/gate.sh` 全绿。

## 风险与回滚

- 风险：极老 DSH 没有右侧栏时插件不可用；这是「只保留侧边栏」的直接代价。
- 回滚：恢复 0005 的浮层回退与 `mount()` 即可，无数据影响。
