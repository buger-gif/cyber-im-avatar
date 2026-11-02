# 0001 不开本地端口：宿主同源路由 + stdio

> 状态: implemented
> 修订: 传输层由 ADR 0005 修订（同源路由保留，去掉 stdio 子进程）
> 日期: 2026-10-31
> 关联: `docs/specs/archive/0002-docs-and-guardrails.md`、`docs/architecture/01-shape.md`

## 背景

0.3.0 的插件在 `127.0.0.1:8787` 起了一个 `ThreadingHTTPServer`，自己发凭据、自己管静态资源、
自己跑 SSE。功能没问题，问题在面：本机任何进程都能敲这个端口，任何网页配合 DNS rebinding
也能；端口是静态的，装完就常驻；每加一个功能（皮肤、静态页、事件流）就要各自补一层鉴权。

用户原话：「插件不要在本地开任何新服务端口，因为新开端口都是威胁，都是攻击面」。

## 决策

插件**不监听任何端口**。宿主半（`lib/index.js`）向 DSH 的 `webServer` 注册同源前缀路由
`/plugins/im-standin`，把请求序列化成 NDJSON 顺管道交给 `service/server.py` 子进程，
应答沿同一管道回来。

## 备选

| 备选 | 为什么不行 |
| --- | --- |
| 保留 8787 但只绑回环 + 强 token | 回环不挡本机其它进程与 DNS rebinding；token 要落到某处给前端读，多一个泄漏面 |
| 换成 Unix socket | 浏览器不能直接连 Unix socket，仍要一层代理，等于回到宿主转发，白白多一个组件 |
| 只在系统 WebView 里用自定义协议 | 依赖宿主实现，换 profile（headless）就没有 WebView；且要改宿主 |
| 前端直接读 SQLite（WASM） | 拉取仍要跑 CLI 子进程，绕不开后端；等于把两个进程合成一个更难测的东西 |

## 后果

- **接受**：没有端口可 `curl`，排障要靠 `service/rpc.py`（一次性进程，同样不开端口）。
- **接受**：没有 SSE / WebSocket，面板 6 秒轮询 `/api/status`。状态是幂等小 JSON，轮询比维护长连接便宜。
- **接受**：token 在进程启动时随机生成、经 `webserver/index-inject` 注入成 `globalThis.IM_STANDIN_TOKEN`。
  重启 DSH 后旧页面 403，刷新即可——这是特性不是 bug。
- **接受**：`headless` profile 没有 `webServer`，插件在那里什么都不做（连子进程都不起）。
- **重新考虑的触发条件**：DSH 收回 `webServer.register` 能力，或需要跨机访问面板（那时应做
  独立服务 + 真实认证，而不是把端口加回来）。
