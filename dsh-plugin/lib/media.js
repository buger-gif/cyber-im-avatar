/**
 * media.js — 唤醒时取回的媒体落盘与清理。
 *
 * 插件只保存指针：state.json 里的 recent[].media_paths 指向这里；二进制不进口
 * state.json，也不新开资源路由。目录 700、文件 600；路径按
 * <root>/<platform>/<chat>/<msg>/<name> 组织，便于整会话删除与 200MB 上限清理。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MEDIA_DIR_NAME = "media";
export const MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MEDIA_MAX_CHAT_BYTES = 200 * 1024 * 1024;

/** 把平台 ID 变成可读、可排序、无路径分隔符的目录名；哈希后缀防碰撞。 */
export function safeSegment(value, fallback = "x") {
  const raw = String(value == null ? "" : value);
  const cleaned = raw.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_").slice(0, 64);
  const hash = crypto.createHash("sha1").update(raw || fallback).digest("hex").slice(0, 8);
  return `${cleaned || fallback}-${hash}`;
}

/** 只保留 basename，拒绝 `..`、绝对路径与路径分隔符；保留中文文件名与扩展名。 */
export function safeFileName(value, fallback = "file") {
  const raw = String(value == null ? "" : value).replace(/\\/g, "/");
  let base = path.basename(raw).trim();
  base = base.replace(/[\u0000-\u001f]/g, "").replace(/[/:]/g, "_");
  if (!base || base === "." || base === "..") base = fallback;
  if (base.startsWith(".")) base = `_${base}`;
  if (base.length > 100) {
    const ext = path.extname(base).slice(0, 12);
    base = base.slice(0, 100 - ext.length) + ext;
  }
  return base;
}

/** 同目录里找一个不冲突的文件名：name、name-2、name-3… */
export function uniquePath(dir, name) {
  const safe = safeFileName(name);
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = path.join(dir, safe);
  let i = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${i}${ext}`);
    i += 1;
  }
  return candidate;
}

export class MediaStore {
  constructor(baseDir = process.env.IM_STANDIN_DIR || path.join(os.homedir(), ".im-standin")) {
    this.baseDir = String(baseDir).replace(/^~(?=$|\/)/, os.homedir());
    this.root = path.join(this.baseDir, MEDIA_DIR_NAME);
  }

  ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
  }

  messageDir(platform, chatId, msgId) {
    return path.join(
      this.root,
      safeSegment(platform, "platform"),
      safeSegment(chatId, "chat"),
      safeSegment(msgId, "msg"),
    );
  }

  ensureMessageDir(platform, chatId, msgId) {
    const dir = this.messageDir(platform, chatId, msgId);
    this.ensureDir(dir);
    return dir;
  }

  /** 把外部下载的文件收进媒体目录；返回最终绝对路径。 */
  keep(dir, srcPath, desiredName) {
    this.ensureDir(dir);
    const dest = uniquePath(dir, desiredName || path.basename(srcPath));
    try {
      fs.renameSync(srcPath, dest);
    } catch (e) {
      if (e?.code !== "EXDEV") throw e;
      // 跨文件系统（CLI 落到 /tmp 或 ~/files）时退回复制 + 删除。
      fs.copyFileSync(srcPath, dest);
      try { fs.unlinkSync(srcPath); } catch { /* best effort */ }
    }
    try { fs.chmodSync(dest, 0o600); } catch { /* best effort */ }
    return dest;
  }

  touchFile(file) {
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  }

  listFiles() {
    const out = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile()) out.push(p);
      }
    };
    walk(this.root);
    return out;
  }

  /**
   * 删除 7 天前的文件，并把单会话总量压到 200MB 以内（从最旧开始）。
   * @returns {{removed: string[], files: number, bytes: number}}
   */
  cleanup({ maxAgeMs = MEDIA_MAX_AGE_MS, maxChatBytes = MEDIA_MAX_CHAT_BYTES, now = Date.now() } = {}) {
    if (!fs.existsSync(this.root)) return { removed: [], files: 0, bytes: 0 };
    const removed = [];
    const kept = [];
    for (const file of this.listFiles()) {
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (now - st.mtimeMs > maxAgeMs) {
        try { fs.unlinkSync(file); removed.push(file); } catch { /* next */ }
        continue;
      }
      kept.push({ file, size: st.size, mtimeMs: st.mtimeMs });
    }
    // 按 <platform>/<chat> 分组做单会话上限；不删除其他平台/会话的配额。
    const groups = new Map();
    for (const row of kept) {
      const rel = path.relative(this.root, row.file).split(path.sep);
      const key = rel.slice(0, 2).join("/");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const rows of groups.values()) {
      let total = rows.reduce((n, r) => n + r.size, 0);
      if (total <= maxChatBytes) continue;
      rows.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const row of rows) {
        if (total <= maxChatBytes) break;
        try {
          fs.unlinkSync(row.file);
          total -= row.size;
          removed.push(row.file);
        } catch { /* next */ }
      }
    }
    this.pruneEmptyDirs(this.root);
    let files = 0;
    let bytes = 0;
    for (const file of this.listFiles()) {
      try {
        const st = fs.statSync(file);
        files += 1;
        bytes += st.size;
      } catch { /* next */ }
    }
    return { removed, files, bytes };
  }

  pruneEmptyDirs(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return true; }
    let empty = true;
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (!this.pruneEmptyDirs(path.join(dir, ent.name))) empty = false;
      } else {
        empty = false;
      }
    }
    if (empty && dir !== this.root) {
      try { fs.rmdirSync(dir); } catch { /* not empty now */ }
      return true;
    }
    return empty;
  }
}
