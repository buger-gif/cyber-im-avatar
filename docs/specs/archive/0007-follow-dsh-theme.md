# 0007 外观跟随 DSH 主题

> 状态: 已验收
> 编号: 0007
> 版本: 0.8.0
> 关联: `docs/specs/contracts/03-config.md`、`dsh-plugin/web/panel.js`

## 背景

面板现在有四套皮肤（`paper` / `console` / `cards` / `studio`），默认值存在
`panel.json` 的 `ui.skin`，设置页还有四宫格选择器，URL 也能用 `?skin=` 临时覆盖。
这带来三个问题：

1. 用户在 DSH 里已经选过浅色/深色，面板还要再选一次，两处设置会打架；
2. 四套皮肤各有结构差异（页签在上 / 左侧竖排导航），维护面比收益大；
3. `ui.skin` 是配置契约里唯一跟值守行为无关的键，却要跟着配置一起迁移、回传、测试。

DSH 的主题解析结果已经落在 DOM 上：`body[data-ds-dark-theme]` 表示当前是深色，
`html[data-ds-theme-source]` 公布 `light` / `dark` / `system`（系统模式下仍是解析后的
浅/深），面板直接读这两个标记即可，不需要自己的设置。

## 目标与非目标

- 目标：删掉四套皮肤与 `ui.skin`；面板只保留浅色/深色两套配色，自动跟随 DSH
  当前主题，默认跟随、不给选项。
- 非目标：
  - 不接 DSH 的组件级 token（`--dsw-*` 不是公共契约，跨版本会漂）；
  - 不跟随系统主题（DSH 自己解析 `system` 后已经落到 `data-ds-dark-theme`）；
  - 不改布局结构、不改轮询/值守行为、不新增接口。

## 方案

### 1. 颜色只剩两套

`web/panel.js` 的 `.ims-root` 保留现有浅色变量作为唯一浅色配色；删除
`[data-skin=...]` 的全部规则，连同皮肤选择器、`data-nav=rail` 的左列导航规则。
深色只覆盖变量：

```css
body[data-ds-dark-theme] .ims-root,
html[data-ds-theme-source=dark] .ims-root { --bg:…; --panel:…; …; color-scheme:dark }
```

两个选择器缺一不可：

- `body[data-ds-dark-theme]`：DSH `ThemePresenter` 在**解析结果为深色**时写入，
  包括「跟随系统」解析成深色的情况；
- `html[data-ds-theme-source=dark]`：固定深色主题的镜像；老版本没有 body 标记时兜底。

CSS 是祖先选择器，DSH 切换主题时无需 reload，也不需要 MutationObserver。

### 2. 删掉面板自己的外观入口

- 删除 `SKINS`、`curSkin()` / `applySkin()` / `setSkin()`、`opts.skin`、
  `?skin=` / `#skin=` 解析、`window.IMStandinPanel.skins`；
- `.ims-root` 不再写 `data-skin`，`.ims-panel` 不再写 `data-nav`；
- 设置页删「外观」整卡；头部齿轮按钮改名为「设置」（只负责跳到设置页）；
- 席位挂载不再从 `/api/status` 读 `config.ui.skin`。

### 3. 配置键退役

`service/config.py` 的 `DEFAULTS` 删除 `ui`；`_upgrade()` 与 `_strip_retired()`
把老 `panel.json` 里的 `ui` 丢掉（与 0004 退役 `llm.*` 同一处理方式），
`POST /api/config` 传 `ui` 也不再生效。契约 03 删除 `ui.skin` 行。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 保留四套皮肤，只把默认改成「跟随 DSH」 | 用户明确要求删掉；选择器本身仍在制造两处设置 |
| 读 `prefers-color-scheme` | 那是系统主题，不是 DSH 里选的浅/深；DSH 默认「跟随系统」时两者才碰巧一致 |
| 用 JS 监听 body 属性并写 `data-appearance` | 纯 CSS 祖先选择器已经够用，少一个 observer 与生命周期 |
| 直接映射 DSH 的 `--dsw-*` token | 组件级别名不是公开契约，DSH 换版本就可能整片失效 |

## 影响面

- 代码：`dsh-plugin/web/panel.js`、`service/config.py`；
- 构建：`python3 scripts/build_client.py` 重建 `lib/client.js`；
- 契约：`docs/specs/contracts/03-config.md` 删除 `ui.skin`；
- 测试：`tests/test_stdio.py` 配置写改用 `poll.interval_min`；
  `tests/test_polling.py` 补 `ui` 退役断言；`scripts/demo/fixture.mjs` 去掉 `ui`；
- 用户可见：设置页不再有「外观」；面板随 DSH 浅/深色自动切换；
- 兼容：老 `panel.json` 的 `ui.skin` 启动时忽略，不改任何值守行为。

## 验收

- [x] DSH 浅色主题下面板为浅色；切到深色（或跟随系统且系统为深色）后
      面板立即变深色，不刷新页面；
- [x] 设置页没有「外观」卡片，`window.IMStandinPanel` 没有 `skins`；
- [x] 老 `panel.json` 写入 `{"ui":{"skin":"console"}}` 后启动，`/api/config`
      不返回 `ui`，值守节奏不受影响；
- [x] `bash scripts/gate.sh` 全绿（含构建产物新鲜度与契约对账）。

## 风险与回滚

- 风险：自定义 DSH 主题若只改 token、不写 `data-ds-dark-theme`，面板会停在浅色；
  这是 DSH 主题约定的一部分，按平台事实处理，不在插件里猜。
- 回滚：恢复 `data-skin` 四套 CSS 与 `ui.skin` 默认值即可；没有数据迁移，
  老配置本来就被忽略。
