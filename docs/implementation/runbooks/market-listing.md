# 进 awesome-dsh-plugin 名单（插件市场收录）

> 这份只讲「让别人在市场里搜得到」。自托管索引（发版时更新 `dsh-plugin/market/index.json`）
> 见 `docs/implementation/runbooks/publish.md`，两者互不替代。

## 谁决定「搜得到」

| 东西 | 是什么 | 谁维护 |
| --- | --- | --- |
| `dsh-market/dsh-market` | 市场 **App**：有 UI、能搜能装能删 | dsh-market |
| `awesome-dsh-plugin` | 名单：`data/plugins/*.yml` → 构建成 `plugins.json` | awesome-dsh-plugin |
| `dsh-plugin/market/index.json` | 我们自己的 format-1 索引源 | 本仓库，随发版更新 |

市场每次打开都实时拉 `https://awesome-dsh-plugin.com/plugins.json`，**不读我们的自托管索引**。
所以「索引源加进去了」和「市场里搜得到」是两件事：前者只对手动加过索引源的人可见。
往 dsh-market 提 PR 没用——它自己写着 *This repo is the market app, not the catalog*。

## 提一个 PR

一个 PR = **一个文件**，别改 README（两个 README 都由脚本生成）：

```
data/plugins/buger-gif__cyber-im-avatar--dsh-plugin.yml
```

```yaml
url: https://github.com/buger-gif/cyber-im-avatar/tree/main/dsh-plugin
name: dsh-cyber-im-avatar
category: identity
description:
  en: '...'
  zh: '...'
```

四条容易踩的：

- **`url` 必须指到子目录。** CI 从它指向的地方读 `dsh.bundle`；本仓库根目录没有
  `package.json`，指根目录第一步就红。子目录名不受 `packages/` · `plugins/` · `apps/` 限制，
  名单里已有先例 `bagpipe1289__dsh-paperflight--plugin.yml`。
- **`name` 写 npm 包名**（`dsh-cyber-im-avatar`），不是 `owner/repo`。
- **不写 `npm:` 字段**，校验会直接拒；映射从 registry 自动采集，前提是
  `dsh-plugin/package.json` 的 `repository` 指回本仓库（已满足，且带 `directory`）。
- 描述含 `: ` 必须加引号，否则 YAML 把它读成嵌套键；描述是对代码的声明，会被逐句核。

## CI 按这个顺序查

1. 条目数 ≤ 3 / PR
2. `dsh.bundle`（只声明 `dsh.client` 必红）
3. 仓库年龄 ≥ 1 天——**结论是快照**，被「0.5 天大」挡住的那条几小时后自己达标，不用推空提交
4. `awesome-lint` + 站点构建

## 被 `held: author` 之后

- 推同一分支，留**一条**评论说明改了啥。反复推、连发追问都不会加速。
- 自查状态：「Held pull requests that may have healed」跟踪 issue，每天 06:19 UTC 刷新。
- `gate` 列是 `—`、或 `READMEs match data/plugins` 红：分支跟 main 撞了，**不归你修**，
  维护者会 rebase——自己重新生成 README 正是历史上把 218 条 PR 卡死的做法。

## 收录后还能补的

- `dsh-plugin` topic：已打。
- `dsh-plugin/screenshots.json`：1–8 张。相对路径不许出插件目录，所以这里用
  `raw.githubusercontent.com` 绝对链接指向 `docs/images/*.png`。
- `icon:`：只收 GitHub 托管的 png/jpg/webp，**收不了 SVG**。不写就回退作者头像，
  自托管索引里那个 SVG data URI 在这边用不上。
- npm 下载量：`repository` 已指回本仓库，自动关联。

## 改描述

改自己那条 `data/plugins/*.yml` 再提 PR，别动别人的条目。功能变了（加平台、改默认行为）
就同步改描述——评审按描述核代码，不一致会被打回。
