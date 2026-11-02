/** sessions.js — 只读 DSH 会话目录的路径换算（不读写会话内容）。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");

export function cwdKey(workspace) {
  const real = (() => {
    try { return fs.realpathSync(workspace); } catch { return path.resolve(workspace); }
  })();
  const p = real.replace(/\/+$/, "").replace(/^\//, "");
  let key = "--";
  for (const ch of p) {
    if (ch === "/") key += "-";
    else if (ch.charCodeAt(0) < 128) key += ch;
    else key += "~" + ch.charCodeAt(0).toString(16).toUpperCase();
  }
  return key + "--";
}

export function sessionDir(sessionId, workspace) {
  if (!sessionId || !workspace) return "";
  return path.join(DSH_HOME, "sessions", cwdKey(workspace), sessionId);
}

export function sessionInWorkspace(sessionId, workspace) {
  if (!sessionId || !workspace) return false;
  try { return fs.statSync(sessionDir(sessionId, workspace)).isDirectory(); } catch { return false; }
}

export function sessionFile(sessionId, workspace = "") {
  if (!sessionId) return "";
  if (workspace) {
    const d = sessionDir(sessionId, workspace);
    if (fs.existsSync(d)) return d;
  }
  const root = path.join(DSH_HOME, "sessions");
  try {
    for (const d of fs.readdirSync(root)) {
      const cand = path.join(root, d, sessionId);
      if (fs.existsSync(cand)) return cand;
    }
  } catch { /* ignore */ }
  return "";
}

export { DSH_HOME };
