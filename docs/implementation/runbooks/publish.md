# 怎么把 DSH 插件发出去

> 从 `dsh-plugin/PUBLISHING.md` 迁入（2026-11-01，`git log --follow` 可追溯）。
> 本文件所有命令默认在**仓库根**执行；`cd dsh-plugin` 开头的块已写明。
> 发版前跑一遍 `bash scripts/gate.sh`（含契约对账、版本一致、构建产物新鲜度）。

> 结论先放前面：**DSH 目前没有"提交审核、官方上架"这回事。**
> 它的插件市场就是一份你自己托管的 JSON 索引（format 1），用户把索引 URL 加进
> 「插件 → 发现」页，就能搜到、装上。所以"发布"= 把包做成可安装的 bundle + 选一条分发通道
> + 把索引挂到一个能被直连的 https 地址上。

以下内容对齐 **DSH 0.2.1-rc.5**（`~/.dsh/runtime` 里随包文档与 `dsh-plugin-market-index` 校验器源码），
不是猜的；DSH 还是预发布版，字段名可能变。

## 一、机制：索引即市场

```
用户加索引 URL ──► host 拉 index.json（format 1）并校验
                      │
                      ├─ 每页 50 条，搜索/分类/标签/排序都在本地算
                      └─ 点「安装」→ 拼出精确 install spec → 交给 plugin-manager
                                                                  │
                                          npm: `name@version` ────┤ 装前先 pnpm view 查 engines/peer
                                          git: `git+url#commit&path:/dir` ── 装后才校验，不满足回滚
```

几个直接影响发版节奏的事实：

| 事实 | 含义 |
| --- | --- |
| 索引默认是空的 | 官方还没上市场，用户必须自己加索引源（插件页「更多」→ 启用**自定义插件市场**） |
| 索引**没有签名** | 索引里的名字和版本只是声明，真正装什么由包自己的 `package.json` 决定 → 社区市场的收录不代表安全 |
| **没有升级动作** | 发现页只把新版本标成「有新版本」，升级得先卸载再装 |
| 索引**拒绝重定向** | 只能用最终 URL（`github.com/.../raw/...` 会 302，要用 `raw.githubusercontent.com`） |
| 索引 URL 不能带 query/fragment/凭据 | 必须是干净的 `http(s)://host/path` |
| 可以私有 | 内网 https 一样能当索引源，官方文档明确支持把内部工具做成私有市场 |

## 二、三条分发路线

| 路线 | install spec | 适合 | 代价 |
| --- | --- | --- | --- |
| **git（推荐起步）** | `git+https://github.com/o/r.git#<40位commit>&path:/dsh-plugin` | 没 npm 账号、想先让人装上 | 每次发版要重算 commit 并重新生成索引；安装前会先 `git ls-remote` 探 GitHub（5s 超时） |
| **npm** | `dsh-cyber-im-avatar@0.1.0` | 有 npm 包名、想被 `pnpm` 生态正常解析 | 需要 npm 账号；装前会 `pnpm view` 查版本/engines，不满足直接失败（一个字节都不下） |
| **只给 GitHub 地址** | 用户手动 `dsh plugin --profile web add <url>` | 早期内部试用 | 没有发现/搜索，用户要知道地址 |

本仓库**两条都备着**：`package.json` 已写好 npm 元数据（`repository` 指回 GitHub、`publishConfig.registry` 写死公网源），
`scripts/make-market-index.mjs --source npm|git` 切换索引里的源类型。当前线上走的是 npm 源。

### npm 首发实测（2026-10，`dsh-cyber-im-avatar@0.1.0`）

两个坑都是真撞出来的，不是查文档抄的：

1. **新包强制 2FA 或 bypass token，缺一边就 403。**
   报错原文：`Two-factor authentication or granular access token with bypass 2fa enabled is
   required to publish packages.` 账号 `two-factor auth: disabled` 时，只能靠
   **Granular Access Token 里勾上「Bypass two-factor authentication」**：
   Permissions 选 *Read and write (publish and stage)*，Packages 选 **All packages**
   （包还不存在，选不了具体包），Expiration 默认 7 天。
   - 只建 token 不勾 bypass → 仍然 403（这次就是这么卡住的）。
   - 网页登录拿到的 session token 也不够，同样 403。
   - 用 `npm login --auth-type=web` 登录后，`whoami` 是通的，只有 publish 卡住——两者权限不同，别被 `whoami` 通误导。
2. **首发会先落一个 `0.0.0-stage` 占位版本。**
   `npm publish` 打印 `+ dsh-cyber-im-avatar@0.1.0` 之后，立刻查 registry 只会看到
   `versions: ["0.0.0-stage"]`、`latest: 0.0.0-stage`，readme 写的是
   "Temporary package placeholder for staged publishing"。**这不是失败**，真版本正在入库：
   包页面已经显示 0.1.0，`dist-tags.latest` 在一两分钟内翻到 `0.1.0`，`versions` 变成两个。
   用 `curl "https://registry.npmjs.org/<pkg>?t=$(date +%s)"` 绕开 CDN 缓存再确认即可。
3. **`+ pkg@ver` 不等于立刻可查（0.9.0 / 0.20.0 实测）。**
   Trusted Publishing 下 `npm publish` 返回 0、打印 `+ dsh-cyber-im-avatar@0.9.0` 之后，
   公开 packument 仍可能只有旧版本，约 **2–3 分钟**后才出现（`time[ver]`、tarball 200、
   `dist-tags.latest` 同批翻新；0.20.0 实测 3 分 8 秒）。期间 `npm view <pkg>@<ver>` 报
   `404 No match found`。CI 的「版本自检」最多轮询 5 分钟；本地确认用带 `?t=` 的 curl，
   别只看一次。自检红了先看 npm 包页：确认版本已上架后 `gh run rerun <run-id> --failed`
   重跑即可（发布步骤看到版本已存在会跳过，不会重发）。

> 往后：npm 计划 **2027 年 1 月起**让 bypass token 只能「暂存发布」，真正发布要维护者用 2FA 批准。
> 长期方案是把发版迁到 GitHub Actions + **trusted publishing（OIDC）**：不需要任何长期 token、
> 自动带 provenance 签名，也就绕开 2FA 交互。

## 三、索引格式（format 1）

官方定义在 `@deepseek-ai/dsh-plugin-market-index` 的校验器里，`scripts/make-market-index.mjs` 生成后会自动用
本机 DSH 自带的这份校验器复核一遍。骨架：

```json
{
  "format": 1,
  "title": { "en": "cyber-im-avatar", "zh-cn": "赛博办公 IM 分身" },
  "metadata": {
    "categories": { "communication": { "title": { "en": "Communication", "zh-cn": "沟通协作" } } },
    "labels": { "local-first": { "title": { "en": "Local first", "zh-cn": "数据留在本机" } } },
    "sortKeys": {}
  },
  "plugins": [{
    "name": "dsh-cyber-im-avatar",
    "title": { "en": "IM Stand-in", "zh-cn": "IM 值守" },
    "description": { "en": "...", "zh-cn": "..." },
    "icon": "data:image/svg+xml;base64,...",
    "author": "buger-gif",
    "homepage": "https://github.com/buger-gif/cyber-im-avatar/tree/main/dsh-plugin",
    "repository": { "url": "https://github.com/buger-gif/cyber-im-avatar", "directory": "dsh-plugin" },
    "metadata": { "category": "communication", "keywords": ["dsh"], "labels": ["local-first"], "sortKeys": {} },
    "versions": [{
      "version": "0.1.0",
      "publishTimestamp": 1793458088,
      "source": { "type": "git", "url": "https://github.com/buger-gif/cyber-im-avatar",
                  "commit": "<40 位小写 hex>", "path": "dsh-plugin" },
      "engines": {}
    }]
  }]
}
```

**踩过的校验规则**（每条都是实测报错，不是文档抄的）：

- 语言 id 必须**小写**：`zh-CN` 会被拒（`must be keyed by a lowercase language id`），写 `zh-cn`。
- 任何本地化标题都必须含 `en`，否则 `must contain en`。
- `source.type` 只有 `npm` / `git` 两种；git 的 `url` 必须 https、canonical（不能带尾斜杠）、至少两段路径；
  `commit` 必须 40 位小写 hex；包在子目录时用 `path`（不能含 `.` `..`）。
- `icon` 要么内联 `data:`（SVG/PNG/JPEG/WebP，解码后 ≤32 KiB），要么同源或 https 相对引用。
- `publishTimestamp` 是**整数 Unix 秒**，不是毫秒。
- `versions` 里版本不能重复，会被按 SemVer 降序重排。
- 未声明的分类/标签 id 会被拒（`references undeclared id`）。

## 四、发版：自动化优先，手动兜底

### A. 自动化（`.github/workflows/publish.yml`，推荐）

push `v*` tag 触发，CI 用 **npm Trusted Publishing（OIDC）** 发布：不需要任何长期 token，
不需要 2FA 交互，产物带 provenance 签名。这也是 npm 明确指定的长期方向——
bypass-2FA token 从 2027-01 起只能"暂存发布"。

**一次性配置**（npm 包页 → Settings → Trusted Publisher → GitHub Actions）：

| 字段 | 值 |
| --- | --- |
| Organization or user | `buger-gif` |
| Repository | `cyber-im-avatar` |
| Workflow filename | `publish.yml`（只写文件名，不带 `.github/workflows/`） |
| Environment | 留空 |

**每次发版**：

```bash
cd dsh-plugin

# 0) 改过 web/panel.js 就必须重建浏览器半
python3 scripts/build_client.py

# 1) 版本号（tag 必须与之相同，CI 会校验不一致就失败）
npm version patch --no-git-tag-version    # 或手改 package.json

# 2) 提交并打 tag —— 发布由 CI 完成
git add -A && git commit -m "chore(release): v$(node -p "require('./package.json').version")"
git push origin main
git tag "v$(node -p "require('./package.json').version")" && git push origin --tags

# 3) 等 CI 变绿、确认包真的上去了，再更新索引（顺序很重要：索引指到没发布的版本 = 装不上）
npm view "dsh-cyber-im-avatar@$(node -p "require('./package.json').version")" version --registry=https://registry.npmjs.org
node scripts/make-market-index.mjs --source npm
git add market/index.json && git commit -m "chore(market): 索引指向 <version>" && git push
```

CI 里还带了四道闸：tag/package.json 版本一致性、`tests/run_tests.py`、`npm pack --dry-run`，
以及发布后最多 5 分钟的 `npm view` 轮询自检。
`workflow_dispatch` 手动触发时默认只打包不发布（`dry_run` 默认 true）。

### B. 手动兜底（本机应急，0.1.0 就是这么发的）

```bash
cd dsh-plugin

# 0) 改完 UI 先重建产物，否则线上跑的还是旧的浏览器半
python3 scripts/build_client.py

# 1) 发 npm
npm publish                    # publishConfig 已锁 https://registry.npmjs.org/
                               # 本机 npm 默认源可能是镜像，务必确认输出的 registry 是公网

# 2) 生成索引（--source npm 对应上面；没发 npm 就用默认的 git）
node scripts/make-market-index.mjs --source npm

# 3) 提交 + 推 GitHub —— 索引地址必须是能直连的 raw 链接
git add market/index.json package.json && git commit -m "chore(market): 更新插件市场索引" && git push
```

手动发布需要拿得出发布凭据，两条（详见"二、三条分发路线"下的首发实测）：

- **带 bypass 2FA 的 granular token**：账号没开 2FA 时唯一的办法。写进 `~/.npmrc` 的
  `//registry.npmjs.org/:_authToken=…`，或用 `NPM_TOKEN` 环境变量。**别提交进仓库**，发完就删。
- **账号开 2FA + `--otp`**：交互式，`npm publish --otp=123456`。

## 五、用户侧配置（一次，之后每次打开都能看到新版本）

1. 插件页 → **实验性插件**旁的「更多」→ 启用 **自定义插件市场**
2. 切到 **发现** → **添加索引源** → 粘贴：
   `https://raw.githubusercontent.com/buger-gif/cyber-im-avatar/main/dsh-plugin/market/index.json`
3. 搜「IM 值守」→ 安装 → 重启 DSH

命令行等价安装（不经过市场）：

```bash
dsh plugin --profile web add dsh-cyber-im-avatar              # npm
dsh plugin --profile web add "git+https://github.com/buger-gif/cyber-im-avatar.git#<commit>&path:/dsh-plugin"
```

## 六、安装时实际发生了什么

- **npm spec**：装前 `pnpm view` 拿到该版本 + `engines` + `peerDependencies`，不满足就**直接失败、不下载、不跑构建脚本**；
  注册表按「配置的 registry → fallbackRegistries（默认 npmmirror）」顺序试，问不到的才换下一个。
- **git spec**：先 `git ls-remote` 探 GitHub（`githubConnectionTimeoutMs` 默认 5000ms，禁凭据助手），
  再 `pnpm add`；**装完才**做 `engines`/peer 检查，不满足会把 profile 的 `package.json` 与 `pnpm-lock.yaml` 回滚。
- **构建脚本**：pnpm 11 会拦依赖脚本，用户在插件页点「允许这些脚本并重试」。本包没有构建脚本（`lib/client.js` 是提交进仓库的产物），不受影响。
- **锁**：包操作与 `dsh plugin` 共用 profile 写锁（默认等 120s），并发安装会排队。

## 七、版本兼容与豁免

- 声明了 `engines.dsh` 就以它**为唯一判据**（0.2.1-alpha.4 起优先于 peer 推断）。
  本包暂未声明，等于不设门禁——因为插件 API（`dsh.client.inject`、slot 名）在 0.2 线上还在动，
  贸然写死范围会让新版本用户装不上。
- 真要收紧时：`"engines": { "dsh": ">=0.2.1-rc.5 <0.4.0" }`，同时索引里的 `versions[].engines` 跟上
  （市场卡片的「安装」按钮按这个判断禁用）。
- 用户侧临时放行：`dsh plugin --profile web allow-version dsh-cyber-im-avatar@0.1.0 --dsh-version <ver> --accept-risk`
  （写进 profile 的 `compatibility.json`，只对精确版本对生效）。

## 八、发版检查清单

- [ ] `python3 scripts/build_client.py` 跑过（改过 `web/panel.js` 就必须跑）
- [ ] `python3 tests/run_tests.py` 全绿
- [ ] `package.json` 版本号动了，`repository` / `homepage` / `bugs` 指回 GitHub
- [ ] `npm pack --dry-run` 里没有 `__pycache__`、`screenshots`、`.db`、`panel.json`
- [ ] 走 CI 发版时：npm 包页的 Trusted Publisher 已登记本仓库 + `publish.yml`；tag 与 version 一致
- [ ] `node scripts/make-market-index.mjs` 通过 format-1 校验
- [ ] 索引指向的 commit / 版本已经**真的存在**（git 源要推 commit，npm 源要确认 `npm view` 拿得到）
- [ ] 装一遍验证：`dsh plugin --profile web add <spec>` → 侧边栏出现「IM 值守」
- [ ] `CHANGELOG.md` 记了这一版

## 九、还没解决的

- 官方市场在路上了，但截至 0.2.1-rc.5 没有提交入口；现在的社区目录（各种 `dsh-market` 站点/仓库）
  是第三方收录，**收录 ≠ 审核**，索引也没有签名。
- 没有自动化升级：只能靠用户看到「有新版本」后卸载重装。
- 索引是一整份 JSON 拉全量，几万条以后要靠服务端查询协议，现在没有。
