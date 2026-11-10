# 2026-11-10 web boot 审计把「还没结算的导入」报成 import failed

> 一次性检查。结论与证据留着，不随修复回改。关联 spec
> `docs/specs/active/0042-宿主入口懒加载与客户端立即预取.md`。

## 现象

DSH 桌面端冷启动，诊断报告写：

```
source: web-boot   phase: running
Error: web boot: 1 entry did not activate
dsh-cyber-im-avatar: import failed (see console for the import error)
```

本机 `~/Library/Logs/DeepSeek Harness/` 里同类 crash log 从 2026-11-03 起共 6 份
（11-03 两份、11-05 两份、11-06、11-10），命名全部只指向 `dsh-cyber-im-avatar`。
11-05 09:24 那份还夹着同批 `dshmarket` 的 bundle transport 失败。

同时，页面打开后插件是工作的：live Client 的 `sidebar.footer.action` 里
`dsh-cyber-im-avatar` 为 `active`；宿主半 `~/.im-standin/state.json` 正常写、
日志有 `[im-standin] ready`。

## 结论

**不是插件代码坏了，是 DSH Web 启动审计的时序竞态。** 插件是「较晚拿到 fiber」的那一行，
页面补建 entry 的异步导入还没结算，审计就来点数了。

## 证据

1. **这句文案的含义**（`@deepseek-ai/dsh-web-frontend` 的 boot 审计，构建产物里的 `qZ`）：
   遍历 Loader entries，`entry.fiber === void 0` 时查模块系统的 `importError(entryName)`；
   查到就打真实错误，查不到才打 `import failed (see console for the import error)`。
   日志里是通用文案 ⇒ `importErrors` 没有这个 id 的记录。

2. **只有两种路径会没有记录**（`@deepseek-ai/dsh-client-modules` 浏览器半）：
   - 导入还在进行中（entry 已建、异步 `prefetch → import → create` 未结算）；
   - boot graph 的 `graphRows` 里没有这一行 —— `import()` 的 not-a-row 分支直接抛错，
     不走 `recordingImportError`，因此不写 `importErrors`。

   两条都是时序问题。

3. **导入不是失败，是晚到**：Cordis Loader 的 `Entry._init()` 在导入失败时
   `logger.error(error)` 后直接 return，不建 fiber；这种 entry 不会自己好起来。
   而现在插件几秒后确实挂上了，说明审计看到的那次导入后来成功了。

4. **同一份代码干净启动是好的**：用本机 `~/.dsh/runtime`（0.2.1-rc.5，与 11-03/05/06 日志同版本）
   起 `--profile web`，隔离 `IM_STANDIN_DIR`，headless Chrome 走 CDP 冷启动：
   - `window.__DSH_BOOT__` 含 `dsh-cyber-im-avatar` 行
     （`plugins/??dsh-cyber-im-avatar/client.js&rev=86868e0ebcf7`，在第二批 application batch）；
   - 控制台只有 `[im-standin] seat mounted` / `dock tab registered`，零报错；
   - `node --check`、`node -e import()` 都通过；factory 在 Chromium 里执行正常。

5. **桌面端的加载方式**：Electron main 在 Host `ready` 时把
   `webServer.collectIndexInjections()` 的结果（含 `window.__DSH_BOOT__`）存下来，
   窗口通过 IPC `DESKTOP_IPC.boot` 取这份快照再启动页面。此后页面还会经 HMR 收到
   当前图并用 `ClientEntries.reconcile()` 补齐差异行 —— 补建 entry 的导入是异步的，
   而启动审计只 await 了 `entries.start()` 的队列。

## 上游补丁草稿（`@deepseek-ai/dsh-client-modules` / `dsh-web-frontend`）

改动一：审计前等页面 entry 队列结算（真正的修法）。

```ts
// dsh-web-frontend 的 boot 审计（构建产物里的 qZ 之前）
// 让审计覆盖 start 之后由 graph sync / retry 补建的 entry。
await entries.whenIdle() // 新增：等价于返回 ClientEntries.queue
auditEntries(loader, modules)
```

改动二：`ClientEntries` 暴露队列结算点（`src/client/entries.ts`）。

```ts
/** Settle every queued start/sync/replace so the boot audit sees final entry states. */
whenIdle(): Promise<void> {
  return this.queue
}
```

改动三：`import()` 的 not-a-row 分支也要记错误，否则审计永远只能打通用文案
（`src/client/system.ts`）：

```ts
if (row === void 0) {
  if (this.factories.has(id)) return this.materialize(id).exports
  const error = new Error(
    `client-modules: cannot resolve "${specifier}" — not a seed word, not a materialized module, and not a row in the boot graph (the runtime mirror of the bundle purity gate)`,
  )
  this.importErrors.set(id, error) // 新增
  throw error
}
```

改动四（可选）：审计把「队列里还有未结算导入」的 entry 报成 `pending (importing)`，
而不是 `import failed`，这样即使时序再变也不会误导用户。

## 本仓库的止损

`docs/specs/active/0042-宿主入口懒加载与客户端立即预取.md`：客户端半 `immediately: true`
（页面在 `entries.start` 前预取该行）+ 宿主入口只静态 import Node 内置、重模块挪进 `boot()`
（fiber 更早出现）。这两条不改变上游语义，只把触发面压到最小。

## 复现与验证脚本

- 复现栈：`~/.dsh/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web`（隔离
  `IM_STANDIN_DIR`）+ headless Chrome CDP 抓 `Runtime.consoleAPICalled` /
  `Runtime.exceptionThrown`，并读 `window.__DSH_BOOT__`。
- 上手命令与结论见当日 log `docs/implementation/log/2026-11-10.md`。
