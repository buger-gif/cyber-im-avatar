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

/**
 * 插件壳主动取回的媒体类型。只有这里列出的类型才在唤醒时下载；
 * 其余类型在 prompt 里标“未适配，可用 CLI 取”。sticker 单独处理：不下载。
 */
export const MEDIA_ADAPTERS = {
  feishu: { types: ["image", "file", "audio", "media", "post"] },
  wecom: { types: ["image", "file", "voice", "video"] },
};

const PLACEHOLDER = {
  sticker: "[表情]", image: "[图片]", file: "[文件]", audio: "[语音]", media: "[视频]",
  post: "[富文本]", interactive: "[卡片]", share_chat: "[群名片]", share_user: "[个人名片]",
  system: "[系统消息]", merge_forward: "[合并转发]", location: "[位置]",
};
export const MEDIA_LABELS = PLACEHOLDER;

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
    cmd_media_download: ["im", "+messages-resources-download", "--message-id", "{msg_id}",
      "--file-key", "{key}", "--type", "{type}", "--output", "{output}", "--as", "user"],
    cmd_mget: ["im", "+messages-mget", "--message-ids", "{msg_id}",
      "--download-resources", "--as", "user"],
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
    f_app_link: [["message_app_link"], ["app_link"]],
    f_media_id: [["media_id"]],
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
    // 媒体命令参数未在本机实测；失败按“未适配”降级，不猜。可用 env.json overrides 改。
    cmd_media: ["media", "download", "--media-id", "{media_id}", "--output", "{output}"],
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
    f_media_id: [["media_id"], ["image", "media_id"], ["file", "media_id"],
      ["voice", "media_id"], ["video", "media_id"]],
    f_chat_name: [["chat_name"]],
    f_chat_mode: [["chat_type"]],
    order: "asc",
    lookback_min: 120,
  },
  dingtalk: {
    cli: "dws",
    // profile list 未登录时返回空数组，必须把「拿不到 ID」当未登录，不能吃缓存。
    cmd_whoami: ["profile", "list"],
    f_self_id: [["profiles", 0, "userId"], ["data", "profiles", 0, "userId"],
      ["current", "userId"]],
    f_self_name: [["profiles", 0, "name"], ["profiles", 0, "nick"], ["current", "name"]],
    require_fresh_self: true,
    cmd_list: ["chat", "+chat-messages", "--group", "{chat_id}", "--limit", "{limit}"],
    cmd_list_user: ["chat", "+chat-messages", "--user", "{chat_id}", "--limit", "{limit}"],
    cmd_chats: ["chat", "+recent-conversations"],
    f_chats: [["data", "conversations"], ["conversations"], ["items"], ["chats"]],
    f_chat_id: [["conversationId"], ["openConversationId"], ["chat_id"]],
    f_chat_name: [["name"], ["title"]],
    f_chat_mode: [["type"], ["conversationType"], ["chat_type"]],
    cmd_search: ["contact", "user", "search", "--query", "{q}"],
    f_search_items: [["result"], ["users"], ["data", "result"], ["data", "users"]],
    f_search_id: [["userId"], ["userid"], ["openDingTalkId"]],
    f_search_name: [["name"], ["nick"], ["displayName"]],
    // 钉钉单聊按 userId 读，会话列表里拿到的 conversationId 才走 --group。
    f_search_chat: [["userId"], ["userid"]],
    cmd_chat_search: ["chat", "+chat-search", "--query", "{q}"],
    f_search_chats: [["chats"], ["conversations"], ["data", "conversations"],
      ["result"], ["items"]],
    cmd_send: ["chat", "+messages-send", "--as", "user", "--chat-id", "{chat_id}",
      "--text", "{text}"],
    cmd_send_user: ["chat", "+messages-send", "--as", "user", "--user", "{chat_id}",
      "--text", "{text}"],
    f_items: [["messages"], ["data", "messages"], ["result", "messages"]],
    f_msg_id: [["messageId"], ["msgId"], ["message_id"], ["id"]],
    f_sender: [["senderId"], ["sender", "userId"], ["sender", "id"], ["sender"]],
    f_sender_name: [["senderName"], ["sender", "name"]],
    f_content: [["text", "content"], ["text"], ["content"]],
    f_time: [["createTime"], ["sendTime"], ["create_time"]],
    f_type: [["msgType"], ["msgtype"], ["type"]],
    f_mentions: [["mentions"], ["atUsers"]],
    order: "desc",
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

/** 钉钉会话 ID 形如 cidr…=（单聊 / 群都可能是它）；其它一律当 userId 走 --user。 */
export function dingtalkIsConversation(chatId) {
  return /^cidr/i.test(String(chatId || ""));
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

function jsonMaybe(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function walkResourceKeys(node, msgType, out) {
  if (Array.isArray(node)) {
    for (const item of node) walkResourceKeys(item, msgType, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.image_key === "string" && /^img_/.test(node.image_key)) {
    out.push({ key: node.image_key, type: "image", name: String(node.file_name || "") });
  }
  if (typeof node.file_key === "string" && /^file_/.test(node.file_key)) {
    const isImage = node.tag === "img" || msgType === "image";
    out.push({ key: node.file_key, type: isImage ? "image" : "file",
      name: String(node.file_name || node.fileName || "") });
  }
  for (const value of Object.values(node)) walkResourceKeys(value, msgType, out);
}

/**
 * 从消息正文里抽飞书资源键。lark-cli 可能给 JSON 字符串，也可能压平成
 * `[image: img_...]` / `<file .../>` 的标记；两种都认。解析不到时由调用方
 * 用 `+messages-mget --download-resources` 兜底。
 */
export function feishuResources(message) {
  const msgType = String(message?.msg_type || "");
  const content = message?.content;
  const found = [];
  const parsed = jsonMaybe(content);
  if (parsed) walkResourceKeys(parsed, msgType, found);
  const text = String(content == null ? "" : content);
  const seen = new Set(found.map((r) => r.key));
  const add = (key, type, name = "") => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push({ key, type, name });
  };
  const reImage = /(?:\[image:\s*|!\[[^\]]*\]\(|<image[^>]*key=["'])(img_[A-Za-z0-9_-]+)/g;
  let m;
  while ((m = reImage.exec(text))) add(m[1], "image");
  const reFileTag = /<file[^>]*\bkey=["'](file_[A-Za-z0-9_-]+)["'][^>]*>/g;
  while ((m = reFileTag.exec(text))) {
    const name = /\bname=["']([^"']+)["']/.exec(m[0]);
    add(m[1], "file", name ? name[1] : "");
  }
  if (!found.length && msgType === "image") {
    const img = /(img_[A-Za-z0-9_-]{5,})/.exec(text);
    if (img) add(img[1], "image");
  }
  if (!found.length && msgType === "file") {
    const file = /(file_[A-Za-z0-9_-]{5,})/.exec(text);
    if (file) add(file[1], "file");
  }
  return [...new Map(found.map((r) => [r.key, r])).values()];
}

export function mediaIdOf(platform, message) {
  if (platform === "wecom") {
    const ad = ADAPTERS.wecom;
    return String(dig(message, ad.f_media_id) || "");
  }
  return feishuResources(message).map((r) => r.key).join(",");
}

const IMAGE_EXT = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif",
};

export function imageMediaType(file) {
  return IMAGE_EXT[String(path.extname(file || "")).toLowerCase()] || "";
}

function displayContent(msgType, raw) {
  const text = String(raw == null ? "" : raw);
  if (!PLACEHOLDER[msgType] || msgType === "text" || msgType === "post") return text;
  if (msgType === "file") {
    const obj = jsonMaybe(text);
    const named = obj && typeof obj === "object" ? (obj.file_name || obj.fileName) : "";
    const tag = /\bname=["']([^"']+)["']/.exec(text);
    const name = String(named || (tag ? tag[1] : "") || "");
    return name ? `[文件: ${name}]` : PLACEHOLDER.file;
  }
  return PLACEHOLDER[msgType];
}

function kindForType(msgType, key = "") {
  if (msgType === "image" || /^img_/.test(key)) return "image";
  if (msgType === "audio" || msgType === "voice") return "audio";
  if (msgType === "media" || msgType === "video") return "video";
  return "file";
}

function resolveInside(dir, file) {
  const p = path.isAbsolute(file) ? file : path.resolve(dir, file);
  const rel = path.relative(dir, p);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return p;
}

function findOutput(dir, stem, savedPath) {
  if (savedPath) {
    const p = resolveInside(dir, savedPath);
    if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    // CLI 可能把相对 output 落到自己的允许根（/tmp、~/files）；saved_path 指向哪就取哪。
    if (path.isAbsolute(savedPath) && fs.existsSync(savedPath) && fs.statSync(savedPath).isFile()) {
      return savedPath;
    }
  }
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ""; }
  const hit = entries
    .filter((e) => e.isFile() && e.name.startsWith(stem))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return hit || "";
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

  /**
   * 能不能判定「@ 我」：有结构化 mentions，或拿得到本人显示名做正文兜底。
   * 企微两者都没有（没有 mentions，auth show 只给 Bot ID），只认 @ 会永远不触发，
   * 界面据此禁掉那个选项，别给一个装好却不动开关。
   */
  get canMention() {
    return !!(this.ad.f_mentions || this.ad.f_self_name);
  }

  resolveCli() {
    const configured = this.env?.platforms?.[this.platform]?.cli_path;
    if (configured && fs.existsSync(configured)) return configured;
    return which(this.ad.cli) || this.ad.cli;
  }

  argv(tmpl, kw = {}) {
    return (tmpl || []).map((a) => String(a).replace(/\{(\w+)\}/g, (_, k) => (k in kw ? String(kw[k]) : `{${k}}`)));
  }

  async run(args, timeout = 45, { cwd = "" } = {}) {
    let rc = 0;
    let stdout = "";
    let stderr = "";
    try {
      const r = await execFileP(this.cli, args, {
        timeout: timeout * 1000,
        maxBuffer: 16 * 1024 * 1024,
        env: childEnv(),
        cwd: cwd || undefined,
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

  /**
   * 下载一条消息里的适配媒体。只在 Turns.wake 命中时调用。
   * @returns {{ok:boolean, files:Array, error:string, unsupported?:boolean, sticker?:boolean}}
   */
  async downloadMedia(message, { dir, timeoutMs = 20000, media } = {}) {
    if (!dir || !media) return { ok: false, files: [], error: "media_dir_unavailable" };
    const msgType = String(message?.msg_type || "");
    if (msgType === "sticker") return { ok: true, files: [], error: "", sticker: true };
    if (this.platform === "feishu") {
      if (!this.ad.cmd_media_download && !this.ad.cmd_mget) {
        return { ok: false, files: [], unsupported: true, error: "media_command_unavailable" };
      }
      return this.downloadFeishu(message, { dir, timeoutMs, media });
    }
    if (this.platform === "wecom") {
      if (!this.ad.cmd_media) {
        return { ok: false, files: [], unsupported: true, error: "media_command_unavailable" };
      }
      return this.downloadWecom(message, { dir, timeoutMs, media });
    }
    return { ok: false, files: [], error: "platform_not_supported", unsupported: true };
  }

  async downloadFeishu(message, { dir, timeoutMs, media }) {
    const msgId = String(message?.msg_id || "");
    const resources = feishuResources(message);
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 20000);
    const files = [];
    const errors = [];
    for (let i = 0; i < resources.length; i += 1) {
      const rem = deadline - Date.now();
      if (rem <= 300) { errors.push("timeout"); break; }
      const r = resources[i];
      const stem = `dl-${i + 1}`;
      const args = this.argv(this.ad.cmd_media_download, {
        msg_id: msgId, key: r.key, type: r.type, output: stem,
      });
      // --output 只允许 cwd/tmp/~/files：把子进程 cwd 指到消息目录，用相对路径落盘。
      const res = await this.run(args, Math.max(1, rem / 1000), { cwd: dir });
      if (res.rc !== 0) {
        errors.push(redact(res.raw || `rc=${res.rc}`, 160));
        continue;
      }
      const saved = dig(res.json, [["data", "saved_path"], ["saved_path"]]) || stem;
      const src = findOutput(dir, stem, saved);
      if (!src) { errors.push(`no_file:${r.key}`); continue; }
      const kind = kindForType(message.msg_type, r.key);
      let name = r.name || path.basename(src);
      if (!path.extname(name) && path.extname(src)) name += path.extname(src);
      if (!name || name === ".") name = `${kind}-${i + 1}${path.extname(src)}`;
      const dest = media.keep(dir, src, name);
      files.push({ path: dest, kind, name: path.basename(dest) });
    }
    if (files.length) return { ok: true, files, error: errors.join("; ") };
    // 正文解析不到资源键（post / 合并转发等）时，让 CLI 只取这一条并下载资源。
    const rem = deadline - Date.now();
    if (msgId && rem > 500 && this.ad.cmd_mget) {
      const res = await this.run(this.argv(this.ad.cmd_mget, { msg_id: msgId }),
        Math.max(1, rem / 1000), { cwd: dir });
      if (res.rc === 0 && res.json) {
        const got = this.collectMgetResources(res.json, { dir, media, msgId, msgType: message.msg_type });
        if (got.files.length) return { ok: true, files: got.files, error: got.error || errors.join("; ") };
        // post 只有文字、没有内嵌图片：不是下载失败，不要标“可用 CLI 取”。
        if (message.msg_type === "post" && got.count === 0) {
          return { ok: true, files: [], error: "", no_media: true };
        }
        if (got.error) errors.push(got.error);
      } else {
        errors.push(redact(res.raw || `rc=${res.rc}`, 160));
      }
    }
    return { ok: false, files, error: errors.join("; ") || "no_resource" };
  }

  collectMgetResources(json, { dir, media, msgId, msgType }) {
    const blocks = [];
    const walk = (node) => {
      if (Array.isArray(node)) { for (const item of node) walk(item); return; }
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.resources)) blocks.push(...node.resources);
      for (const value of Object.values(node)) walk(value);
    };
    walk(json);
    const mine = blocks.filter((r) => !msgId || !r?.message_id || String(r.message_id) === String(msgId));
    const use = mine.length ? mine : blocks;
    const files = [];
    const errors = [];
    for (let i = 0; i < use.length; i += 1) {
      const r = use[i] || {};
      if (r.error) { errors.push(`download_failed:${r.key || i}`); continue; }
      const rel = r.local_path || r.localPath || "";
      const src = rel ? resolveInside(dir, rel) : findOutput(path.join(dir, "lark-im-resources"), "img_", "");
      if (!src || !fs.existsSync(src)) { errors.push(`missing_local_path:${r.key || i}`); continue; }
      const kind = r.type === "image" || /^img_/.test(String(r.key || ""))
        ? "image" : kindForType(msgType, r.key);
      let name = path.basename(src);
      if (!name || name === ".") name = `${kind}-${i + 1}`;
      const dest = media.keep(dir, src, name);
      files.push({ path: dest, kind, name: path.basename(dest) });
    }
    media.pruneEmptyDirs(dir);
    return { files, error: errors.join("; "), count: use.length };
  }

  async downloadWecom(message, { dir, timeoutMs, media }) {
    const mediaId = mediaIdOf("wecom", message);
    if (!mediaId) return { ok: false, files: [], error: "missing_media_id" };
    const stem = "dl-1";
    const res = await this.run(
      this.argv(this.ad.cmd_media, { media_id: mediaId, output: stem }),
      Math.max(1, Number(timeoutMs) / 1000),
      { cwd: dir },
    );
    if (res.rc !== 0) {
      const raw = String(res.raw || `rc=${res.rc}`);
      const unsupported = /unknown command|unrecognized|not found|no such|不支持/i.test(raw);
      return { ok: false, files: [], unsupported, error: redact(raw, 200) };
    }
    const saved = dig(res.json, [["data", "saved_path"], ["saved_path"], ["path"]]) || stem;
    const src = findOutput(dir, stem, saved);
    if (!src) return { ok: false, files: [], error: "no_file" };
    const kind = kindForType(message.msg_type);
    let name = String(message.file_name || message.filename || path.basename(src));
    if (!path.extname(name) && path.extname(src)) name += path.extname(src);
    const dest = media.keep(dir, src, name || `${kind}${path.extname(src)}`);
    return { ok: true, files: [{ path: dest, kind, name: path.basename(dest) }], error: "" };
  }

  async whoami() {
    const cached = this.env?.platforms?.[this.platform] || {};
    let selfId = cached.self_id || "";
    let name = null;
    const { rc, json, raw } = await this.run(this.ad.cmd_whoami);
    if (rc === 0 && json) {
      const fresh = dig(json, this.ad.f_self_id);
      // 钉钉未登录时 profile list 返回空数组：不能拿缓存 self_id 冒充已登录。
      if (this.ad.require_fresh_self && !fresh) {
        return { ok: false, self_id: null, name, detail: redact(raw || "未登录", 300) };
      }
      selfId = fresh || selfId;
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
    const id = String(chatId || "");
    let tmpl = this.ad.cmd_list;
    if (this.platform === "feishu" && id.startsWith("ou_") && this.ad.cmd_list_user) {
      tmpl = this.ad.cmd_list_user;
    } else if (this.platform === "dingtalk" && !dingtalkIsConversation(id) && this.ad.cmd_list_user) {
      tmpl = this.ad.cmd_list_user;
    }
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
    const mtype = String(dig(it, this.ad.f_type) || "text").toLowerCase();
    const rawContent = String(dig(it, this.ad.f_content) || "");
    const ts = String(dig(it, this.ad.f_time) || "");
    const msg = {
      msg_id: String(mid),
      sender_id: String(dig(it, this.ad.f_sender) || ""),
      sender_name: String(dig(it, this.ad.f_sender_name) || ""),
      content: displayContent(mtype, rawContent),
      ts,
      ts_epoch: parseTs(ts),
      msg_type: mtype,
      mentions: dig(it, this.ad.f_mentions) || [],
      app_link: String(dig(it, this.ad.f_app_link) || ""),
      media_id: "",
    };
    msg.media_id = this.platform === "wecom"
      ? String(dig(it, this.ad.f_media_id) || "")
      : mediaIdOf(this.platform, { ...msg, content: rawContent });
    return msg;
  }

  async listChats(limit = 15) {
    if (!this.ad.cmd_chats) return { ok: false, items: [], error: "该平台 CLI 不提供会话枚举，只能用已登记目标" };
    const { rc, json, raw } = await this.run(this.argv(this.ad.cmd_chats, { limit: String(limit) }));
    if (rc !== 0 || !json) return { ok: false, items: [], error: redact(raw || `rc=${rc}`) };
    const chats = dig(json, this.ad.f_chats) || [];
    const out = [];
    for (const c of chats) {
      const cid = dig(c, this.ad.f_chat_id) || c?.chat_id;
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
    } else if (this.platform === "dingtalk") {
      const tmpl = dingtalkIsConversation(chatId)
        ? this.ad.cmd_send : (this.ad.cmd_send_user || this.ad.cmd_send);
      args = this.argv(tmpl, { chat_id: chatId, text });
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
    const items = dig(json, this.ad.f_search_items
      || [["data", "users"], ["users"], ["data", "items"], ["items"]]) || [];
    // 飞书返回的是 localized_name；只回可读名称，找不到就留空，由面板隐藏，
    // 不把 open_id 当名字展示。
    const out = items.map((u) => ({
      id: String(dig(u, this.ad.f_search_id)
        || u?.open_id || u?.userid || u?.user_id || u?.id || ""),
      chat_id: String(dig(u, this.ad.f_search_chat) || u?.p2p_chat_id || ""),
      name: String(dig(u, this.ad.f_search_name)
        || u?.localized_name || u?.name || u?.user_name || u?.nickname || ""),
      department: String(dig(u, [["department"]]) || u?.department || ""),
    })).filter((x) => x.id);
    return { ok: true, items: out, error: "" };
  }

  async searchChats(q, limit = 20) {
    if (!this.ad.cmd_chat_search) return { ok: false, items: [], error: "该平台不支持按群名搜索，请直接填 chat_id" };
    const { rc, json, raw } = await this.run(this.argv(this.ad.cmd_chat_search, { q, limit: String(limit) }));
    if (rc !== 0 || !json) return { ok: false, items: [], error: redact(raw || `rc=${rc}`) };
    const chats = dig(json, this.ad.f_search_chats || this.ad.f_chats) || [];
    const out = [];
    for (const c of chats) {
      const cid = dig(c, this.ad.f_chat_id) || c?.chat_id;
      if (!cid) continue;
      const mode = String(dig(c, this.ad.f_chat_mode) || "");
      out.push({
        chat_id: String(cid),
        name: String(dig(c, this.ad.f_chat_name) || ""),
        kind: mode.toLowerCase().includes("p2p") ? "p2p" : "group",
      });
    }
    return { ok: true, items: out, error: "" };
  }
}

const AT_BOUNDARY = /[\s，。！？、；：,.!?;:）)\]】}"'“”‘’]/;

function atToken(content, name) {
  const needle = "@" + name;
  let i = content.indexOf(needle);
  while (i >= 0) {
    const before = i === 0 ? "" : content[i - 1];
    const after = content[i + needle.length] || "";
    if ((!before || AT_BOUNDARY.test(before)) && (!after || AT_BOUNDARY.test(after))) return true;
    i = content.indexOf(needle, i + 1);
  }
  return false;
}

export function isMention(msg, selfId, selfNames) {
  const uid = String(selfId || "");
  const names = (selfNames || []).map((n) => String(n || "")).filter(Boolean);
  const mentions = (msg?.mentions || []).filter((m) => m && typeof m === "object");
  if (mentions.length) {
    // 有结构化 mentions 时只认 ID：别人 @“张三丰”不能被当成 @“张三”。
    if (uid) {
      for (const mt of mentions) {
        const mid = mt.id;
        const cands = [
          typeof mid === "object" ? mid?.open_id : mid,
          mid?.user_id, mid?.union_id, mt.open_id, mt.user_id, mt.union_id, mt.key,
        ];
        if (cands.some((c) => c && String(c) === uid)) return true;
      }
      return false;
    }
    // 拿不到 self_id 时只接受 name 完全相等，不做子串兜底。
    for (const mt of mentions) {
      const nm = String(mt.name || "");
      if (nm && names.some((n) => n === nm)) return true;
    }
    return false;
  }
  const content = String(msg?.content || "");
  if (content.includes("@_user_")) return false;
  return names.some((n) => atToken(content, n));
}

export class IM {
  constructor({ dir = ENV_DIR, media = null } = {}) {
    this.dir = dir;
    this.media = media;
    this.adapters = {};
    this.env = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, "env.json"), "utf8")); } catch { return {}; }
    })();
  }

  adapter(platform) {
    if (!this.adapters[platform]) this.adapters[platform] = new Adapter(platform, { dir: this.dir });
    return this.adapters[platform];
  }

  /**
   * 只在唤醒时调用：下载一个会话里本批待回消息的媒体。
   * 未适配类型返回 unsupported=true，由 prompt 提示 agent 走 CLI。
   */
  async downloadMedia(platform, chatId, message, { timeoutMs = 20000 } = {}) {
    const spec = MEDIA_ADAPTERS[platform];
    if (!spec) return { ok: false, files: [], unsupported: true, error: "platform_not_supported" };
    const msgType = String(message?.msg_type || "");
    if (msgType === "sticker") return { ok: true, files: [], sticker: true, error: "" };
    if (!spec.types.includes(msgType)) {
      return { ok: false, files: [], unsupported: true, error: `unsupported_type:${msgType || "unknown"}` };
    }
    if (!this.media) return { ok: false, files: [], error: "media_unavailable" };
    let dir;
    try {
      dir = this.media.ensureMessageDir(platform, chatId, message.msg_id);
    } catch (e) {
      return { ok: false, files: [], error: `media_dir: ${e?.message || e}` };
    }
    try {
      return await this.adapter(platform).downloadMedia(message, { dir, timeoutMs, media: this.media });
    } catch (e) {
      return { ok: false, files: [], error: `${e?.name || "Error"}: ${e?.message || e}` };
    }
  }

  cliPath(platform) {
    try { return this.adapter(platform).cli; } catch { return ADAPTERS[platform]?.cli || ""; }
  }
}
