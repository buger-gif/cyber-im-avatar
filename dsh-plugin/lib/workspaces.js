/**
 * workspaces.js — DSH 工作区登记表的只读适配。
 *
 * 工作区就是 DSH 的「打开目录」。插件只读 ~/.dsh/storages/workspace.json
 * 做展示与校验；真正把会话挂到工作区走宿主 workspaceRegistry.resolveByPath()。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const STORAGE = path.join(DSH_HOME, "storages", "workspace.json");

function loadStorage() {
  try {
    return JSON.parse(fs.readFileSync(STORAGE, "utf8"));
  } catch {
    return {};
  }
}

export function realpathIfExists(p) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    return "";
  }
}

export function normalize(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const expanded = s.replace(/^~(?=$|\/)/, os.homedir());
  if (!path.isAbsolute(expanded)) return "";
  const canonical = realpathIfExists(expanded);
  return canonical && fs.statSync(canonical).isDirectory() ? canonical : "";
}

export function listWorkspaces() {
  const data = loadStorage();
  const table = data?.tables?.workspaces || {};
  const defaultId = data?.global?.defaultWorkspaceId || "";
  const out = [];
  for (const [id, ws] of Object.entries(table)) {
    const raw = ws?.path || "";
    if (!raw) continue;
    const canonical = normalize(raw) || path.normalize(raw);
    let exists = false;
    try { exists = fs.statSync(canonical).isDirectory(); } catch { exists = false; }
    out.push({
      id,
      path: canonical,
      title: ws?.title || path.basename(canonical.replace(/\/+$/, "")) || canonical,
      is_default: id === defaultId,
      exists,
      sessions: Array.isArray(ws?.sessionIds) ? ws.sessionIds.length : 0,
      updated_at: ws?.updatedAt || "",
    });
  }
  out.sort((a, b) => (Number(!a.is_default) - Number(!b.is_default)) ||
    String(a.title).localeCompare(String(b.title)));
  return out;
}

export function defaultPath() {
  const items = listWorkspaces();
  const explicit = items.find((w) => w.is_default && w.exists);
  if (explicit) return explicit.path;
  const any = items.find((w) => w.exists);
  return any ? any.path : "";
}

export function describe(raw) {
  const p = normalize(raw);
  if (!p) {
    return { path: "", title: path.basename(String(raw || "").replace(/\/+$/, "")) || String(raw || ""),
      id: "", in_dsh: false, exists: false };
  }
  const hit = listWorkspaces().find((w) => normalize(w.path) === p || path.normalize(w.path) === p);
  if (hit) {
    return { path: p, title: hit.title, id: hit.id, in_dsh: true, exists: hit.exists !== false };
  }
  return { path: p, title: path.basename(p.replace(/\/+$/, "")) || p,
    id: "", in_dsh: false, exists: true };
}

/**
 * 会话实际会在哪个工作区跑。
 * source=chat 表示显式绑定；不存在时调用方必须明确失败，不能偷换默认。
 */
export function resolveForChat(chat) {
  const raw = String(chat?.workspace || "").trim();
  if (raw) {
    const p = normalize(raw);
    if (p) {
      const info = describe(p);
      return { ...info, source: "chat", fallback: false };
    }
    return {
      path: "", title: path.basename(raw.replace(/\/+$/, "")) || raw,
      id: "", in_dsh: false, exists: false, source: "chat", fallback: false,
    };
  }
  const d = defaultPath();
  if (d) {
    const info = describe(d);
    return { ...info, source: "default", fallback: true };
  }
  return { path: "", title: "", id: "", in_dsh: false, exists: false,
    source: "none", fallback: false };
}

export function effectivePath(chat) {
  return resolveForChat(chat).path || "";
}

/**
 * 面板「最近在用的工作区」的服务端等价：有没有显式绑定过工作区的会话里，
 * 取 `session_bound_at || added_at || last_sync` 最大者的工作区。
 * 口径必须与 `web/panel.js` 的 lastUsedWs() 一致；分诊不读浏览器本地记忆。
 */
export function lastUsedPath(chats) {
  let best = "";
  let at = -1;
  for (const chat of Object.values(chats || {})) {
    const p = normalize(chat && chat.workspace);
    if (!p) continue;
    const t = Number(chat.session_bound_at) || Number(chat.added_at) || Number(chat.last_sync) || 0;
    if (t > at) {
      at = t;
      best = p;
    }
  }
  return best;
}

/**
 * 自动分诊开首个值班会话时用的工作区：显式配置 → 最近在用 → 空（跟随 DSH 默认）。
 * 与面板「加入值守时绑定工作区」同序；返回空表示不要写绑定。
 */
export function resolveJoinDefault(chats, config) {
  const configured = normalize(config && config.join_workspace);
  return configured || lastUsedPath(chats) || "";
}

/** 展示用：给会话行补 workspace_* 字段。 */
export function decorateChat(chat) {
  const info = resolveForChat(chat);
  const explicit = !!String(chat?.workspace || "").trim();
  chat.workspace_title = explicit ? (info.title || "") : "";
  chat.workspace_in_dsh = explicit ? !!info.in_dsh : false;
  chat.workspace_exists = explicit ? !!info.exists : false;
  chat.workspace_effective = info.path || "";
  chat.workspace_effective_title = info.title || "";
  chat.workspace_fallback = !!info.fallback;
  chat.workspace_missing = !!(explicit && !info.exists);
  return chat;
}

export { DSH_HOME };
