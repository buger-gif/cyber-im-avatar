/**
 * profiles.js — 每个服务对象一份 Markdown 画像。
 *
 * 文件是唯一事实源：面板、agent、插件都读写它；env.json 不再存画像。
 * 目录 700、文件 600，写入走临时文件 + rename；上限 12KB，拒绝而不是静默截断。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const MAX_PROFILE = 12 * 1024;
const PLATFORM_LABEL = { feishu: "飞书", wecom: "企业微信", dingtalk: "钉钉" };
const SAFE = /[^0-9A-Za-z._\-\u4e00-\u9fff]+/g;

function safePart(value) {
  return String(value || "").trim().replace(SAFE, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 80);
}

export function profileRel(platform, chatId = "", name = "") {
  const plat = safePart(platform) || "unknown";
  let file = safePart(chatId);
  if (!file) {
    const base = safePart(name) || "target";
    const digest = crypto.createHash("sha1").update(String(name || "")).digest("hex").slice(0, 6);
    file = `${base}-${digest}`;
  }
  return path.join("profiles", plat, `${file}.md`);
}

export function profileTemplate(name, platform, chatId, notes = []) {
  const label = PLATFORM_LABEL[platform] || platform;
  const lines = [
    `# ${name || chatId || "服务对象"}`,
    "",
    `> ${label} · ${chatId || "未绑定会话"}`,
    "> 画像由值守 agent 与面板共同维护：只写下次值守还会用到的信息，不保存聊天原文。",
    "",
    "## 对方是谁",
    "",
    "## 沟通偏好",
    "",
    "## 在意与忌讳",
    "",
    "## 历史结论",
    "",
  ];
  for (const n of notes || []) lines.push(`- ${n}`);
  if (notes && notes.length) lines.push("");
  return lines.join("\n");
}

export function excerpt(text, limit = 180) {
  for (const line of String(text || "").split(/\r?\n/)) {
    let s = line.trim();
    if (!s || s.startsWith("#") || s.startsWith(">")) continue;
    if (s.startsWith("- ") || s.startsWith("* ")) s = s.slice(2).trim();
    return s.slice(0, limit);
  }
  return "";
}

export class Profiles {
  constructor(dir = process.env.IM_STANDIN_DIR || path.join(os.homedir(), ".im-standin")) {
    this.dir = String(dir).replace(/^~(?=$|\/)/, os.homedir());
    this.root = path.join(this.dir, "profiles");
  }

  ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
  }

  abs(rel) {
    if (!rel) return "";
    const full = path.resolve(path.isAbsolute(rel) ? rel : path.join(this.dir, rel));
    const root = path.resolve(this.dir);
    if (full !== root && !full.startsWith(root + path.sep)) return "";
    return full;
  }

  pathFor(platform, chatId, name = "") {
    return this.abs(profileRel(platform, chatId, name));
  }

  readPath(file) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return "";
    }
  }

  mtime(file) {
    try {
      return fs.statSync(file).mtimeMs / 1000;
    } catch {
      return 0;
    }
  }

  ensure(platform, chatId, name = "") {
    const file = this.pathFor(platform, chatId, name);
    if (!file) return { path: "", text: "", mtime: 0, created: false };
    let created = false;
    if (!fs.existsSync(file)) {
      this.ensureDir(path.dirname(file));
      this.writeRaw(file, profileTemplate(name, platform, chatId));
      created = true;
    }
    return { path: file, text: this.readPath(file), mtime: this.mtime(file), created };
  }

  read(platform, chatId, name = "") {
    return this.ensure(platform, chatId, name);
  }

  writeRaw(file, text) {
    this.ensureDir(path.dirname(file));
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    try {
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, file);
      try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
    } finally {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best effort */ }
    }
  }

  /**
   * 写画像。expectedMtime > 0 时做一次 CAS：用户期间改过就放弃 agent 回写。
   * @returns {{ok: boolean, reason?: string, path?: string, text?: string, mtime?: number, conflict?: boolean}}
   */
  write(platform, chatId, name, text, expectedMtime = 0) {
    if (typeof text !== "string") return { ok: false, reason: "text 必须是字符串" };
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAX_PROFILE) return { ok: false, reason: "画像超过 12KB" };
    const file = this.pathFor(platform, chatId, name);
    if (!file) return { ok: false, reason: "画像路径不合法" };
    if (expectedMtime > 0) {
      const current = this.mtime(file);
      if (current && Math.abs(current - expectedMtime) > 0.001) {
        return { ok: false, reason: "profile_conflict", conflict: true, path: file };
      }
    }
    const body = text.trim() ? text : profileTemplate(name, platform, chatId);
    this.writeRaw(file, body.endsWith("\n") ? body : body + "\n");
    return { ok: true, path: file, text: this.readPath(file), mtime: this.mtime(file) };
  }

  delete(platform, chatId, name = "") {
    const file = this.pathFor(platform, chatId, name);
    if (!file) return false;
    try { fs.unlinkSync(file); return true; } catch { return false; }
  }
}
