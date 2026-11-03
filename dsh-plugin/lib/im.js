/**
 * im.js — 平台 CLI 适配层（飞书 / 企业微信）。
 *
 * 只做四件事：拉消息、列会话、搜人/搜群、以本人身份发消息、查身份。
 * 平台差异只落在命令模板 + 字段候选路径；上层轮询不含平台分支。
 * 直接 spawn 平台 CLI，不经过 Python，也不读消息正文以外的任何密钥。
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const ENV_DIR = process.env.IM_STANDIN_DIR || path.join(os.homedir(), ".im-standin");
export const ENV_PATH = path.join(ENV_DIR, "env.json");

export const PLATFORM_META = {
  feishu: { label: "飞书", short: "飞", color: "#3370FF" },
  wecom: { label: "企业微信", short: "企", color: "#07C160" },
  dingtalk: { label: "钉钉", short: "钉", color: "#1890FF" },
};

const PLACEHOLDER = {
  sticker: "[表情]", image: "[图片]", file: "[文件]", audio: "[语音]", media: "[视频]",
  post: "[富文本]", interactive: "[卡片]", share_chat: "[群名片]", share_user: "[个人名片]",
  system: "[系统消息]", merge_forward: "[合并转发]", location: "[位置]",
};

export const ADAPTERS = {
  feishu: {
    cli: "lark-cli",
    cmd_whoami: ["auth", "status"],
    f_self_id: [["identities", "user", "openId"]],
    f_self_name: [["identities", "user", "userName"]],
    f_token_status: [["identities", "user", "tokenStatus"]],
    cmd_list: ["im", "+chat-messages-list", "--chat-id", "{chat_id}",
      "--order", "desc", "--limit", "{limit}", "--as", "user"],
    cmd_list_user: ["im", "+chat-messages-list", "--user-id", "{chat_id}",
      "--order", "desc", "--limit", "{limit}", "--as", "user"],
    cmd_chats: ["im", "+chat-list", "--as", "user", "--types", "p2p,group",
      "--sort", "active_time", "--page-size", "{limit}"],
    cmd_send: ["im", "+messages-send", "--chat-id", "{chat_id}",
      "--msg-type", "text", "--text", "{text}", "--as", "user"],
    cmd_send_user: ["im", "+messages-send", "--user-id", "{chat_id}",
      "--msg-type", "text", "--text", "{text}", "--as", "user"],
    cmd_search: ["contact", "+search-user", "--query", "{q}", "--as", "user"],
    cmd_chat_search: ["im", "+chat-search", "--as", "user", "--query", "{q}",
      "--page-size", "{limit}"],
    f_items: [["data", "messages"], ["data", "items"], ["messages"], ["items"]],
    f_chats: [["data", "chats"], ["chats"]],
    f_msg_id: [["message_id"]],
    f_sender: [["sender", "id"]],
    f_sender_name: [["sender", "name"]],
    f_content: [["content"], ["body", "content"]],
    f_time: [["create_time"], ["create_at"]],
    f_type: [["msg_type"]],
    f_mentions: [["mentions"]],
    f_chat_name: [["name"]],
    f_chat_mode: [["chat_mode"]],
    order: "desc",
  },
  wecom: {
    cli: "wecom-cli",
    cmd_whoami: ["auth", "show"],
    self_id_regex: /Bot ID:\s*(\S+)/,
    cmd_list: ["chat", "messages", "list", "--chat-id", "{chat_id}",
      "--begin-time", "{begin_time}", "--end-time", "{end_time}"],
    cmd_send: ["message", "send", "--chat-id", "{chat_id}",
      "--msg-type", "text", "--text", "{text}"],
    cmd_search: ["contact", "users", "search", "--keywords", "{q}"],
    f_items: [["messages"], ["data", "messages"]],
    f_count: [["messages_count"], ["data", "messages_count"]],
    f_has_more: [["has_more"], ["data", "has_more"]],
    f_msg_id_compose: [["send_time"], ["userid"], ["text", "content"]],
    f_sender: [["userid"], ["sender"], ["from", "userid"]],
    f_sender_name: [["user_name"], ["sender_name"]],
    f_content: [["text", "content"], ["content"]],
    f_time: [["send_time"], ["create_time"]],
    f_type: [["msg_type"]],
    f_chat_name: [["chat_name"]],
    f_chat_mode: [["chat_type"]],
    order: "asc",
    lookback_min: 120,
  },
};

export function loadEnv() {
  try { return JSON.parse(fs.readFileSync(ENV_PATH, "utf8")); } catch { return {}; }
}

export function dig(obj, paths) {
  if (!paths) return undefined;
  const list = Array.isArray(paths) && (Array.isArray(paths[0]) || typeof paths[0] === "string")
    ? paths : [paths];
  for (const p of list) {
    const keys = Array.isArray(p) ? p : [p];
    let cur = obj;
    let ok = true;
    for (const k of keys) {
      if (cur && typeof cur === "object" && !Array.isArray(cur) && k in cur) cur = cur[k];
      else if (Array.isArray(cur) && Number.isInteger(k) && k >= -cur.length && k < cur.length) cur = cur[k];
      else { ok = false; break; }
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

export function redact(value, limit = 600) {
  let s = value == null ? "" : String(value);
  s = s.replace(/(token|secret|api[_-]?key|password)["']?\s*[:=]\s*["']?[\w\-./+]{8,}/gi, "$1=***");
  s = s.replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***");
  return s.slice(0, limit);
}

export function parseTs(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] || 0));
    return d.getTime() / 1000;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n / (s.length >= 13 ? 1000 : 1);
  return 0;
}

function timeWindow(lookbackMin) {
  const end = new Date();
  const begin = new Date(end.getTime() - Math.max(5, Number(lookbackMin) || 120) * 60 * 1000);
  const fmt = (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
      `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  return { begin_time: fmt(begin), end_time: fmt(end) };
}

export function childEnv() {
  const env = { ...process.env };
  const parts = String(env.PATH || "").split(":").filter(Boolean);
  for (const d of [path.join(os.homedir(), ".nvm/versions/node"), "/usr/local/bin", "/opt/homebrew/bin"]) {
    try { if (fs.statSync(d).isDirectory() && !parts.includes(d)) parts.push(d); } catch { /* ignore */ }
  }
  const nvm = path.join(os.homedir(), ".nvm/versions/node");
  try {
    for (const v of fs.readdirSync(nvm).sort().reverse()) {
      const b = path.join(nvm, v, "bin");
      if (fs.existsSync(b) && !parts.includes(b)) parts.push(b);
    }
  } catch { /* ignore */ }
  env.PATH = parts.join(":");
  return env;
}

function which(name) {
  for (const dir of String(process.env.PATH || "").split(":").filter(Boolean)) {
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return "";
}

function firstJson(text) {
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch !== "{" && ch !== "[") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j += 1) {
      const c = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "{" || c === "[") depth += 1;
      else if (c === "}" || c === "]") {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(s.slice(i, j + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

function outline(obj, depth = 0) {
  if (Array.isArray(obj)) return obj.length && depth < 2 ? [outline(obj[0], depth + 1)] : [];
  if (obj && typeof obj === "object") {
    if (depth >= 2) return "…";
    return Object.fromEntries(Object.entries(obj).slice(0, 12).map(([k, v]) => [k, outline(v, depth + 1)]));
  }
  return typeof obj;
}

export class Adapter {
  constructor(platform, { dir = ENV_DIR } = {}) {
    if (!ADAPTERS[platform]) throw new Error(`unsupported platform: ${platform}`);
    this.platform = platform;
    this.dir = dir;
    this.env = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, "env.json"), "utf8")); } catch { return {}; }
    })();
    this.ad = { ...ADAPTERS[platform], ...((this.env.overrides || {})[platform] || {}) };
    this.cli = this.resolveCli();
  }

  resolveCli() {
    const configured = this.env?.platforms?.[this.platform]?.cli_path;
    if (configured && fs.existsSync(configured)) return configured;
    return which(this.ad.cli) || this.ad.cli;
  }

  argv(tmpl, kw = {}) {
    return (tmpl || []).map((a) => String(a).replace(/\{(\w+)\}/g, (_, k) => (k in kw ? String(kw[k]) : `{${k}}`)));
  }

  async run(args, timeout = 45) {
    let rc = 0;
    let stdout = "";
    let stderr = "";
    try {
      const r = await execFileP(this.cli, args, {
        timeout: timeout * 1000,
        maxBuffer: 16 * 1024 * 1024,
        env: childEnv(),
        windowsHide: true,
      });
      stdout = r.stdout || "";
      stderr = r.stderr || "";
    } catch (e) {
      rc = typeof e.code === "number" ? e.code : (e.killed || e.signal ? 124 : 127);
      stdout = e.stdout || "";
      stderr = e.stderr || e.message || "";
    }
    const raw = String(stdout || "").trim();
    const json = firstJson(raw);
    return { rc, json, raw: json ? raw : raw + (stderr ? `\n${stderr}` : "") };
  }

  async whoami() {
    const cached = this.env?.platforms?.[this.platform] || {};
    let selfId = cached.self_id || "";
    let name = null;
    const { rc, json, raw } = await this.run(this.ad.cmd_whoami);
    if (rc === 0 && json) {
      selfId = dig(json, this.ad.f_self_id) || selfId;
      name = dig(json, this.ad.f_self_name) || null;
      const tok = dig(json, this.ad.f_token_status);
      return { ok: true, self_id: selfId, name, detail: tok ? `token=${tok}` : "" };
    }
    const pat = this.ad.self_id_regex;
    const m = pat && raw ? pat.exec(raw) : null;
    if (m) return { ok: true, self_id: m[1], name, detail: "text-mode" };
    return { ok: false, self_id: selfId || null, name, detail: redact(raw || "未登录", 300) };
  }

  async fetchMessages(chatId, { limit = 10, lookbackMin } = {}) {
    const kw = { chat_id: chatId, limit: String(limit) };
    if (this.platform === "wecom") Object.assign(kw, timeWindow(lookbackMin || this.ad.lookback_min || 120));
    const tmpl = this.platform === "feishu" && String(chatId).startsWith("ou_") && this.ad.cmd_list_user
      ? this.ad.cmd_list_user : this.ad.cmd_list;
    const { rc, json, raw } = await this.run(this.argv(tmpl, kw));
    if (rc !== 0 || !json) return { ok: false, messages: [], error: redact(raw || `rc=${rc}`) };
    const items = dig(json, this.ad.f_items);
    if (items === undefined || items === null) {
      const cnt = dig(json, this.ad.f_count);
      const more = dig(json, this.ad.f_has_more);
      if (cnt === 0 || more === false) return { ok: true, messages: [], error: "" };
      return { ok: false, messages: [], error: "SCHEMA_MISMATCH " + redact(JSON.stringify(outline(json)), 300) };
    }
    let msgs = (Array.isArray(items) ? items : []).map((it) => this.norm(it)).filter(Boolean);
    if ((this.ad.order || "desc").toLowerCase() === "asc") msgs = msgs.reverse();
    return { ok: true, messages: msgs, error: "" };
  }

  norm(it) {
    let mid = dig(it, this.ad.f_msg_id);
    if (!mid) {
      const comp = this.ad.f_msg_id_compose;
      if (comp) {
        const parts = comp.map((p) => {
          const v = dig(it, Array.isArray(p) ? p : [p]);
          return v == null ? "" : String(v);
        });
        mid = "fp_" + crypto.createHash("md5").update(parts.join("|")).digest("hex").slice(0, 16);
      }
    }
    if (!mid) return null;
    const mtype = dig(it, this.ad.f_type) || "text";
    let content = dig(it, this.ad.f_content) || "";
    if (PLACEHOLDER[mtype] && !String(content || "").trim()) content = PLACEHOLDER[mtype];
    const ts = String(dig(it, this.ad.f_time) || "");
    return {
      msg_id: String(mid),
      sender_id: String(dig(it, this.ad.f_sender) || ""),
      sender_name: String(dig(it, this.ad.f_sender_name) || ""),
      content: String(content || ""),
      ts,
      ts_epoch: parseTs(ts),
      msg_type: mtype,
      mentions: dig(it, this.ad.f_mentions) || [],
    };
  }

  async listChats(limit = 15) {
    if (!this.ad.cmd_chats) return { ok: false, items: [], error: "该平台 CLI 不提供会话枚举，只能用已登记目标" };
    const { rc, json, raw } = await this.run(this.argv(this.ad.cmd_chats, { limit: String(limit) }));
    if (rc !== 0 || !json) return { ok: false, items: [], error: redact(raw || `rc=${rc}`) };
    const chats = dig(json, this.ad.f_chats) || [];
    const out = [];
    for (const c of chats) {
      const cid = c?.chat_id;
      if (!cid) continue;
      const mode = String(dig(c, this.ad.f_chat_mode) || "");
      out.push({
        chat_id: String(cid),
        name: String(dig(c, this.ad.f_chat_name) || cid),
        kind: mode.includes("p2p") ? "p2p" : "group",
      });
    }
    return { ok: true, items: out, error: "" };
  }

  async sendText(chatId, text) {
    let args;
    if (this.platform === "wecom") {
      args = this.argv(this.ad.cmd_send, { chat_id: chatId, text: JSON.stringify({ content: text }) });
    } else if (String(chatId).startsWith("ou_") && this.ad.cmd_send_user) {
      args = this.argv(this.ad.cmd_send_user, { chat_id: chatId, text });
    } else {
      args = this.argv(this.ad.cmd_send, { chat_id: chatId, text });
    }
    const { rc, json, raw } = await this.run(args, 60);
    if (rc !== 0) return { ok: false, error: redact(raw || `rc=${rc}`, 400) };
    if (json && json.ok === false) return { ok: false, error: redact(JSON.stringify(json), 400) };
    return { ok: true, message_id: dig(json, [["data", "message_id"], ["message_id"]]) || "" };
  }

  async search(q) {
    const { rc, json, raw } = await this.run(this.argv(this.ad.cmd_search, { q }));
    if (rc !== 0 || !json) return { ok: false, items: [], error: redact(raw || `rc=${rc}`) };
    const items = dig(json, [["data", "users"], ["users"], ["data", "items"], ["items"]]) || [];
    // 飞书返回的是 localized_name；只回可读名称，找不到就留空，由面板隐藏，
    // 不把 open_id 当名字展示。
    const out = items.map((u) => ({
      id: String(u?.open_id || u?.userid || u?.user_id || u?.id || ""),
      chat_id: String(u?.p2p_chat_id || ""),
      name: String(u?.localized_name || u?.name || u?.user_name || u?.nickname || ""),
      department: String(u?.department || ""),
    })).filter((x) => x.id);
    return { ok: true, items: out, error: "" };
  }

  async searchChats(q, limit = 20) {
    if (!this.ad.cmd_chat_search) return { ok: false, items: [], error: "该平台不支持按群名搜索，请直接填 chat_id" };
    const { rc, json, raw } = await this.run(this.argv(this.ad.cmd_chat_search, { q, limit: String(limit) }));
    if (rc !== 0 || !json) return { ok: false, items: [], error: redact(raw || `rc=${rc}`) };
    const chats = dig(json, this.ad.f_chats) || [];
    const out = [];
    for (const c of chats) {
      if (!c?.chat_id) continue;
      const mode = String(dig(c, this.ad.f_chat_mode) || "");
      out.push({
        chat_id: String(c.chat_id),
        name: String(dig(c, this.ad.f_chat_name) || ""),
        kind: mode.toLowerCase().includes("p2p") ? "p2p" : "group",
      });
    }
    return { ok: true, items: out, error: "" };
  }
}

export function isMention(msg, selfId, selfNames) {
  const uid = String(selfId || "");
  const mentions = (msg?.mentions || []).filter((m) => m && typeof m === "object");
  if (mentions.length && uid) {
    for (const mt of mentions) {
      const mid = mt.id;
      const cands = [
        typeof mid === "object" ? mid?.open_id : mid,
        mid?.user_id, mid?.union_id, mt.open_id, mt.user_id, mt.union_id, mt.key,
      ];
      if (cands.some((c) => c && String(c) === uid)) return true;
    }
    for (const mt of mentions) {
      const nm = String(mt.name || "");
      for (const n of selfNames || []) {
        if (n && nm && (n === nm || nm.includes(n))) return true;
      }
    }
  }
  const content = String(msg?.content || "");
  if (content.includes("@_user_")) return false;
  for (const n of selfNames || []) {
    if (n && content.includes("@" + n)) return true;
  }
  return false;
}

export class IM {
  constructor({ dir = ENV_DIR } = {}) {
    this.dir = dir;
    this.adapters = {};
    this.env = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, "env.json"), "utf8")); } catch { return {}; }
    })();
  }

  adapter(platform) {
    if (!this.adapters[platform]) this.adapters[platform] = new Adapter(platform, { dir: this.dir });
    return this.adapters[platform];
  }

  cliPath(platform) {
    try { return this.adapter(platform).cli; } catch { return ADAPTERS[platform]?.cli || ""; }
  }
}
