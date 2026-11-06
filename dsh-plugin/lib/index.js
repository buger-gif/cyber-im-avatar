/**
 * dsh-cyber-im-avatar — 宿主半（Node，单进程）。
 *
 * 插件**不开端口**：浏览器侧走 DSH 自己的 Web 服务，这里注册一条同源前缀
 * 路由 `/plugins/im-standin`，请求直接在宿主进程里交给 `lib/app.js`。
 * 没有 Python 子进程、没有 stdio、没有 SQLite、没有 headless。
 *
 * 三层校验（都过了才进 API）：
 *   1. 连接来自回环地址；Host 头也是回环名 —— 挡 DNS rebinding；
 *   2. 有 Origin 时必须与 Host 同源 —— 挡跨站表单/脚本；
 *   3. 请求头带本次进程随机生成的 token —— 挡同机其它页面瞎猜路径。
 * 没有 webServer 的 profile（比如 headless）里不挂路由，也不启动轮询。
 */
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { State } from "./state.js";
import { Profiles } from "./profiles.js";
import { IM } from "./im.js";
import { MediaStore } from "./media.js";
import { Poller } from "./poller.js";
import { Turns } from "./turns.js";
import { TurnLog } from "./turn-log.js";
import { App } from "./app.js";
import { ensureSkill } from "./skill-install.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = "/plugins/im-standin";
const TOKEN = randomBytes(24).toString("hex");
const LOG = "[im-standin]";
const MAX_BODY = 1 << 20; // 1 MiB：传的都是 JSON 参数

let state = null;
let profiles = null;
let im = null;
let media = null;
let poller = null;
let turns = null;
let app = null;
let turnLog = null;
let alive = false;
let rootCtx = null;
let registry = null;
let sessionController = null;
let sessions = null;
let attachments = null;
let llm = null;
let permissionPresets = null;
let mediaTimer = null;

function cleanupMedia() {
  if (!media || !state) return;
  try {
    const r = media.cleanup();
    const pruned = state.pruneMediaPaths();
    if (r.removed.length || pruned) {
      console.log(LOG, `media cleanup: removed ${r.removed.length} file(s)`);
    }
  } catch (e) {
    console.warn(LOG, "media cleanup failed:", e && e.message);
  }
}

// ---- 进程内装配 -----------------------------------------------------------
function boot() {
  if (app) return app;
  state = new State();
  state.load();
  profiles = new Profiles(state.dir);
  media = new MediaStore(state.dir);
  turnLog = new TurnLog(state.dir, { logger: console });
  im = new IM({ dir: state.dir, media });
  poller = new Poller({ state, im });
  turns = new Turns({ state, profiles, poller, im, media, turnLog });
  poller.turns = turns;
  app = new App({ state, im, poller, turns, profiles, turnLog });
  if (registry) turns.setRegistry(registry);
  if (sessionController && sessions) {
    turns.setHost({ sessionController, sessions, attachments, llm, permissionPresets }, rootCtx);
  }
  cleanupMedia();
  if (mediaTimer) clearInterval(mediaTimer);
  mediaTimer = setInterval(cleanupMedia, 24 * 60 * 60 * 1000);
  if (mediaTimer.unref) mediaTimer.unref();
  poller.start();
  console.log(LOG, "ready; state =", state.statePath);
  return app;
}

function wireHost() {
  if (app && sessionController && sessions) {
    turns.setHost({ sessionController, sessions, attachments, llm, permissionPresets }, rootCtx);
  }
  if (app && registry) turns.setRegistry(registry);
}

function shutdown() {
  try { poller?.stop(); } catch { /* noop */ }
  try { turns?.stopAll(); } catch { /* noop */ }
  if (mediaTimer) clearInterval(mediaTimer);
  mediaTimer = null;
  poller = null;
  turns = null;
  profiles = null;
  im = null;
  media = null;
  state = null;
  app = null;
  turnLog = null;
  registry = null;
  sessionController = null;
  sessions = null;
  attachments = null;
  llm = null;
  permissionPresets = null;
  rootCtx = null;
}

// ---- 请求校验 -------------------------------------------------------------
function isLoopbackAddr(addr) {
  const s = String(addr || "").replace(/^::ffff:/, "");
  return s === "::1" || s === "127.0.0.1" || s.startsWith("127.");
}

function hostName(hostHeader) {
  const h = String(hostHeader || "").toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  return h.split(":")[0];
}

function hostIsLocal(hostHeader) {
  const name = hostName(hostHeader);
  return name === "localhost" || name === "::1" || /^127\./.test(name);
}

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 同源导航/工具请求没有 Origin
  try {
    const u = new URL(origin);
    if (!hostIsLocal(u.host)) return false;
    return u.host.toLowerCase() === String(req.headers.host || "").toLowerCase();
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  const data = JSON.stringify(obj === undefined ? {} : obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(data);
}

async function handler(req, res) {
  if (!isLoopbackAddr(req.socket && req.socket.remoteAddress)) {
    return send(res, 403, { error: "loopback only" });
  }
  if (!hostIsLocal(req.headers.host) || !originOk(req)) {
    return send(res, 403, { error: "cross-origin denied" });
  }
  if (req.headers["x-im-token"] !== TOKEN) {
    return send(res, 401, { error: "missing or stale token; refresh the page" });
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");
  let path = url.pathname;
  if (path.startsWith(PREFIX)) path = path.slice(PREFIX.length) || "/";
  if (!path.startsWith("/api/")) return send(res, 404, { error: "not found", path });

  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") return send(res, 204, {});

  let body = {};
  if (method === "POST" || method === "DELETE" || method === "PUT") {
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw);
    } catch (e) {
      return send(res, 400, { error: "bad body: " + (e && e.message) });
    }
  }

  const inst = boot();
  const out = await inst.handle(path, method, url.searchParams, body);
  return send(res, out.status, out.body);
}

// ---- 挂载 -----------------------------------------------------------------
function mount(ctx) {
  // 工作区服务是 DSH 自己的：只借它归属会话，不碰它的存储。
  try {
    ctx.inject(["workspaceRegistry"], (regCtx) => {
      registry = regCtx.workspaceRegistry;
      wireHost();
    });
  } catch (e) {
    console.warn(LOG, "workspaceRegistry unavailable:", e && e.message);
  }

  // live turn 需要宿主里的 sessionController 与 sessions；两者都到齐才可用。
  try {
    ctx.inject(["sessionController"], (hostCtx) => {
      sessionController = hostCtx.sessionController;
      wireHost();
    });
  } catch (e) {
    console.warn(LOG, "sessionController unavailable:", e && e.message);
  }
  try {
    ctx.inject(["sessions"], (hostCtx) => {
      sessions = hostCtx.sessions;
      wireHost();
    });
  } catch (e) {
    console.warn(LOG, "sessions unavailable:", e && e.message);
  }

  // 富媒体交付：附件服务与模型信息都是可选能力；旧 DSH 没有时自动降级为文本+路径。
  try {
    ctx.inject(["attachments"], (hostCtx) => {
      attachments = hostCtx.attachments;
      wireHost();
    });
  } catch (e) {
    console.warn(LOG, "attachments unavailable:", e && e.message);
  }
  try {
    ctx.inject(["llm"], (hostCtx) => {
      llm = hostCtx.llm;
      wireHost();
    });
  } catch (e) {
    console.warn(LOG, "llm unavailable:", e && e.message);
  }

  // 画像由 agent 自己写；只有 dsh.full_access=true 时才需要这个服务把会话切到
  // danger-full-access。旧 DSH 没有它也能跑，只是写画像会被沙箱拒绝。
  try {
    ctx.inject(["permissionPresets"], (hostCtx) => {
      permissionPresets = hostCtx.permissionPresets;
      wireHost();
    });
  } catch (e) {
    console.warn(LOG, "permissionPresets unavailable:", e && e.message);
  }

  ctx.inject(["webServer"], (webCtx) => {
    try {
      // 把入口和 token 交给页面：panel 用相对路径 + 这个 token 调接口。
      webCtx.on("webserver/index-inject", (table) => {
        table.push({ kind: "global", name: "IM_STANDIN_API", value: PREFIX });
        table.push({ kind: "global", name: "IM_STANDIN_TOKEN", value: TOKEN });
      });
      webCtx.effect(() => webCtx.webServer.register({
        kind: "prefix",
        path: PREFIX,
        handler,
      }));
      boot();
    } catch (e) {
      console.warn(LOG, "route registration failed:", e && e.message);
    }
  });
}

export const name = "dsh-cyber-im-avatar";

export function apply(ctx) {
  alive = true;
  rootCtx = ctx;
  // 插件驱动的会话靠 `/cyber-im-avatar` 自动注入 skill；首次启动时把 skill 装到
  // DSH 扫描的 ~/.agents/skills/。已有手装副本不覆盖（见 skill-install.js）。
  try {
    ensureSkill(console);
  } catch (e) {
    console.warn(LOG, "skill install skipped:", e && e.message);
  }
  try {
    mount(ctx);
  } catch (e) {
    console.warn(LOG, "mount failed:", e && e.message);
  }
  try {
    ctx.effect(() => () => {
      alive = false;
      shutdown();
    });
  } catch (e) {
    console.warn(LOG, "dispose hook failed:", e && e.message);
  }
}
