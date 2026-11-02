/**
 * 在真实 DSH 里截图（README 用）。
 *
 *   node scripts/shot-dsh.mjs [outDir]
 *
 * 干三件事：
 *   1. 起一个**干净工作区**的 DSH 实例（端口 3099），侧边栏里不会出现真实项目名；
 *   2. 页面加载前注入 fetch 拦截，把值守面板的数据换成 scripts/demo/fixture.mjs；
 *   3. 依次点：席位 → 收件箱 → 会话详情（手动发送）→ 分身实例 → 服务对象。
 *
 * 结束后把 DSH 关掉，只留图片。
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { openSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { intercept } from "./demo/fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = pathResolve(process.argv[2] || pathResolve(HERE, "..", "screenshots"));
const PORT = 3099;
const WS = "/tmp/dsh-shot-workspace";
const LOG = "/tmp/dsh-shot.log";
const BIN = pathResolve(process.env.HOME, ".dsh/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(WS, { recursive: true });
await fs.rm(LOG, { force: true });

// ---- 1. 起 DSH ------------------------------------------------------------
const logFd = openSync(LOG, "a");
const dsh = spawn(process.execPath, [BIN, "web", "--no-open", "--port", String(PORT)], {
  cwd: WS,
  detached: true,
  stdio: ["ignore", logFd, logFd],
  env: { ...process.env, NODE_OPTIONS: "", PYTHONPATH: "", BASH_ENV: "" },
});
dsh.unref();

let url = null;
for (let i = 0; i < 120; i++) {
  try {
    const txt = await fs.readFile(LOG, "utf8");
    const m = txt.match(/dsh web: (http:\/\/\S+)/);
    if (m) { url = m[1]; break; }
  } catch {}
  await sleep(500);
}
if (!url) {
  console.error("DSH 没起来，看 " + LOG);
  try { process.kill(-dsh.pid); } catch {}
  process.exit(1);
}
console.log("dsh:", url);
await sleep(2500);

// ---- 2. 无头浏览器 --------------------------------------------------------
const cdpPort = 9711;
const chromeDir = "/tmp/cdp-shot-dsh";
await fs.rm(chromeDir, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  "--no-first-run", "--no-default-browser-check", "--remote-allow-origins=*",
  `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeDir}`,
  "--window-size=1440,900", "about:blank",
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const list = await r.json();
    page = list.find((t) => t.type === "page");
    if (page) break;
  } catch {}
  await sleep(250);
}
if (!page) { console.error("浏览器没起来"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
// 拦截要在页面脚本之前就位
await send("Page.addScriptToEvaluateOnNewDocument", { source: intercept });
await send("Page.navigate", { url });

// 等 DSH 把席位挂上（插件日志里会打印 seat mounted）
for (let i = 0; i < 60; i++) {
  const r = await send("Runtime.evaluate", {
    expression: "!!document.querySelector('.ims-seat')", returnByValue: true,
  });
  if (r.result && r.result.value) break;
  await sleep(700);
}
await sleep(1500);

async function shot(name) {
  const s = await send("Page.captureScreenshot", { format: "png" });
  const file = pathResolve(OUT, name + ".png");
  await fs.writeFile(file, Buffer.from(s.data, "base64"));
  console.log("saved", file);
}
const run = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });

async function waitOpen(expr, tries) {
  for (let i = 0; i < tries; i++) {
    const r = await run(expr);
    if (r.result && r.result.value) return true;
    await sleep(400);
  }
  return false;
}

// ---- 3. 分镜 --------------------------------------------------------------
// 01 全局：DSH 正常界面 + 侧边栏底部的值守席位（带未读数）
const probe = await run(`(() => {
  const e = document.elementFromPoint(Math.round(innerWidth * 0.84), Math.round(innerHeight * 0.59));
  return e ? (e.tagName + "." + (e.className || "")).slice(0, 120) : "none";
})()`);
console.log("probe:", JSON.stringify(probe.result && probe.result.value));
await shot("01-全局-席位");

// 02 点开席位：右侧栏停靠的收件箱（谁在等你回）
await run("document.querySelector('.ims-seat').click(); 'ok'");
let opened = await waitOpen("!!document.querySelector('.ims-panel.open')", 25);
if (!opened) {
  // 空视图下没有可停靠的会话：先新建一个，再点一次席位
  await run(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => (x.getAttribute('aria-label') || '') === '新建会话');
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(1800);
  await run("document.querySelector('.ims-seat').click(); 'ok'");
  opened = await waitOpen("!!document.querySelector('.ims-panel.open')", 25);
}
if (!opened) console.warn("值守面板没有打开，截图可能不对");
await sleep(1200);
await shot("02-收件箱");

// 03 会话详情：消息流 + 手动发送 + 实例状态
await run("document.querySelector('.ims-row').click(); 'ok'");
await sleep(2200);
await shot("03-会话详情");

// 05 分身实例：绑的哪个 DSH 会话、几轮、工作区与最近的习惯
await run("document.querySelectorAll('.ims-tab')[1].click(); 'ok'");
await sleep(1400);
await shot("05-分身实例");

// 06 服务对象：每个人的习惯时间线
await run("document.querySelectorAll('.ims-tab')[2].click(); 'ok'");
await sleep(1400);
await shot("06-服务对象");

// ---- 4. 收尾 --------------------------------------------------------------
try { ws.close(); } catch {}
try { chrome.kill("SIGKILL"); } catch {}
try { process.kill(-dsh.pid); } catch {}
console.log("done");
process.exit(0);
