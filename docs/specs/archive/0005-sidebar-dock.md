# 0005 右侧栏停靠（面板不浮窗）

> 状态: 已验收
> 编号: 0005
> 版本: 0.1.0
> 关联: `docs/specs/archive/0004-skill-shell.md`、`docs/specs/contracts/01-api.md`

## 背景

0004 把面板收缩成壳之后，交互逻辑已经变成「主界面看值守会话，面板看收件箱」，
但 UI 仍是居中浮层 + 半透明遮罩：打开收件箱就盖住 DSH，没法一边看 agent 干活
一边处理消息。用户要求「别浮窗了，侧边栏好一点」。

DSH 客户端本身有右侧栏（文件 / 终端 / 计划住的地方），并提供公开扩展点：

- `ctx.sidebarRightTabs.register({ id, kind, title, guide? })` 注册页类型；
- `sidebar.right.pane.tab`（keyed，按 `id`）注册页体；
- `ctx.sidebarRight.openTab(kind)` 在当前屏幕会话的右侧栏打开 / 聚焦；
- 布局按会话存 localStorage，关闭、切会话、刷新后各自独立。

不碰 DSH 本体，也不自己写侧栏布局。

## 目标与非目标

- 目标：面板停靠在 DSH 右侧栏，和值守会话并排；侧边栏底部只留一个入口席位
  （带未读角标）；「去会话」切主界面时右侧栏尽量跟随；老 DSH 没有右侧栏服务时
  退回原浮层，不白屏。
- 非目标：
  - 不做**全局**右侧栏（DSH 的右侧栏按会话隔离，没有全局扩展点）；
  - 不在 tab 标题上做未读数（角标留在席位，避免每会话重复请求）；
  - 不改任何 API / 表 / 配置键；
  - 不改 60s 通知轮询与 10 分钟拉取下限。

## 方案

### 1. 注册

```js
ctx.sidebarRightTabs.register({
  id: "dsh-cyber-im-avatar/inbox",
  kind: "cyberImInbox",
  priority: "extension",
  multiple: false,
  title: () => "IM 值守",
  guide: [{ id: "inbox", title: () => "IM 值守", description: () => "收件箱、分身实例与手动发送" }],
});
```

页体注册进 `sidebar.right.pane.tab`，`key` 用同一 `id`。不注册 title 槽，
标签页标题用注册时捕获的 `title()`，少一个组件。

### 2. 两个挂载点

| 挂载 | 位置 | 职责 |
| --- | --- | --- |
| 席位 `mountSeat` | `sidebar.footer.action` | 只画入口 + 未读角标；60s 轮 `/api/status`；点击调 `openDock()` |
| 面板 `mountDock` | `sidebar.right.pane.tab` | 同一份面板 DOM，去掉席位/遮罩/关闭按钮，铺满标签页；数据加载与 60s tick 照旧 |

「去会话」在停靠模式下**不关面板**：`uiWorkspace.openSession(sid)` 切主界面，
随后在目标会话的右侧栏重新 `openTab(kind)`（右侧栏布局按会话存，不补这一下
面板会跟着旧会话消失）。跳转仍在会话内进行，失败退回复制 id。

### 3. 布局

- 停靠态 `data-mode=dock`：`position:relative`、宽高 100%、无圆角/阴影/遮罩；
- 头部只剩同步、暂停、外观三个图标按钮（文字标签隐藏，关闭按钮不渲染）；
- 页签压缩到一行，窄了横向滚动；内容区单列；
- 席位态 `data-mode=seat` 只有一行入口；独立预览页仍用 `mount()` 的原浮层。

### 4. 退化

`slots` 是静态依赖；`sidebarRightTabs` / `sidebarRight` 用 `ctx.inject` 等。
3 秒内没等到右侧栏服务 → 挂回原浮层席位，日志 `using overlay fallback`。
DSH 0.2 预览版接口若改名，最坏结果是退回浮层，不会没有入口。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 保留居中浮层，只把遮罩调淡 | 用户明确不要浮窗；主界面仍被盖住，没法边看 agent 边回消息 |
| 注册 `main` 全局面板（像插件页） | 全局但会顶掉主会话，违背「并排看」的诉求 |
| 自己写固定右侧抽屉 + 改 DSH 布局留白 | 改 DSH 本体，且布局宽度/折叠状态要跟着 DSH 走，维护面大 |
| 每个会话都自动打开值守 tab | 用户没打开时强行改布局；只做「点席位 / 去会话」两条显式路径 |
| tab 标题带未读数字 | DSH 右侧栏每个会话各存一份标题，轮询成本翻倍；角标在席位已够 |

## 影响面

- `lib/client.template.js`：注册 tab 类型 / 页体 / 席位；`openSession` 后补开 tab；
  老 DSH 浮层回退。
- `web/panel.js`：`mount` 增加 dock 模式；新增 `mountSeat` / `mountDock`；停靠 CSS。
- `package.json`：`dsh.client.inject` 声明 sidebar / sidebar-right 包依赖。
- `scripts/shot-dsh.mjs`：先点席位开右侧栏，再拍收件箱/详情/分身/服务对象。
- 文档：README 截图与用法、CHANGELOG、architecture 01 形态、PROGRESS。
- 不变：API、SQLite、panel.json、轮询节奏、屏蔽语义、会话生命周期。

## 验收

- [x] 点侧边栏席位 → 右侧栏出现「IM 值守」标签页，主会话仍可见；3080 实测
- [x] 收件箱、详情、分身、服务对象、体检、设置六个视图在 ~500–650px 宽度可用
      （逐个切换无横向溢出）
- [x] 详情「去会话」→ 主界面切到绑定会话，右侧栏仍停靠（目标会话自动补开）；3080 实测
- [x] 关闭标签页后再点席位可重新打开；不出现重复席位 / 重复面板；3080 实测
- [x] 停靠态无遮罩、无浮层定位、无关闭按钮；独立预览页仍是原浮层（HTTP 预览实测）
- [x] 老 DSH（无右侧栏服务）3 秒后回退浮层，日志有记录（代码路径检查；目标 DSH 走停靠路径）
- [x] `python3 -m unittest discover -s tests` 全过 + `bash scripts/gate.sh --quick` 全绿

## 风险与回滚

- **右侧栏 API 是 0.2 预览版**：`sidebarRightTabs` / `sidebarRight` 改名会让停靠
  失效；有 3 秒回退浮层兜底，失败只影响形态不影响值守。
- **布局按会话存**：新会话默认没有值守 tab，需点一次席位；用 DSH 侧边栏切会话
  时也可能收不到停靠面板，「去会话」路径已自动补开。这是 DSH 的布局模型，
  不在插件侧强行改。
- 回滚：删掉 tab 注册并让席位回到 `mount()` 即可，无数据迁移、无契约变更。
