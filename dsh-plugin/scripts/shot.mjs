// CDP 截图：node scripts/shot.mjs <url> <out.png> [waitMs] [width] [height] [js]
const [url, out, waitMs = "6000", w = "1400", h = "900", js] = process.argv.slice(2);
const { spawn } = await import("node:child_process");
const fs = await import("node:fs/promises");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9333 + Math.floor(Math.random() * 200);
const child = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--no-default-browser-check", "--remote-allow-origins=*", `--remote-debugging-port=${port}`,
  "--user-data-dir=/tmp/cdp-shot-" + port, `--window-size=${w},${h}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome not ready");
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  var m;
  try { m = JSON.parse(ev.data); } catch (e) { return; }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((r, rej) => { ws.onopen = r; ws.onerror = rej; });
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});

const logs = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.consoleAPICalled") {
    logs.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
  }
  if (m.method === "Runtime.exceptionThrown") {
    logs.push("EXCEPTION: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
  }
  if (m.method === "Log.entryAdded") {
    logs.push("log." + m.params.entry.level + ": " + String(m.params.entry.text).slice(0, 300));
  }
});
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url });
await sleep(+waitMs);
if (js) {
  const r = await send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true });
  console.log("eval:", JSON.stringify(r.result && r.result.value).slice(0, 400));
  await sleep(1200);
}
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(out, Buffer.from(shot.data, "base64"));
const text = await send("Runtime.evaluate", { expression: "document.body.innerText.slice(0,600)", returnByValue: true });
console.log("TEXT:", JSON.stringify(text.result && text.result.value));
if (logs.length) console.log("LOGS:\n" + logs.slice(-25).join("\n"));
console.log("saved", out);
ws.close();
child.kill("SIGKILL");
process.exit(0);
