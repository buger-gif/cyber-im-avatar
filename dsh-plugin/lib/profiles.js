/**
 * profiles.js — 两层 Markdown：人物档案 + 会话工作本。
 *
 * 文件是唯一事实源：面板、agent、插件都读写它；env.json 不存画像索引。
 * 目录 700、文件 600，写入走临时文件 + rename；每份上限 12KB，拒绝而不是静默截断。
 * DSH 壳内由 agent 直接读/写（配合 dsh.full_access）；插件只负责建模板和面板 I/O。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const MAX_PROFILE = 12 * 1024;
const PLATFORM_LABEL = { feishu: "飞书", wecom: "企业微信", dingtalk: "钉钉" };
const SAFE = /[^0-9A-Za-z._\-\u4e00-\u9fff]+/g;

/** 与 scripts/bootstrap.py 的 _SAFE_RE 规则逐字节一致：golden 测试两边共享。 */
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

/**
 * 人物档案路径：profiles/people/<platform>/<person_id>.md。
 * person_id 是平台消息发送者 ID（飞书 open_id / 企微 userid / 钉钉 senderId），
 * 不用显示名；空 ID 返回空串（不建档案）。
 */
export function personRel(platform, personId = "") {
  const plat = safePart(platform) || "unknown";
  const id = safePart(personId);
  if (!id) return "";
  return path.join("profiles", "people", plat, `${id}.md`);
}

/** 会话工作本：只写本会话成立的要求与上下文；个人评价写人物档案。 */
export function profileTemplate(name, platform, chatId, notes = []) {
  const label = PLATFORM_LABEL[platform] || platform;
  const lines = [
    `# ${name || chatId || "服务对象"}`,
    "",
    `> ${label} · ${chatId || "未绑定会话"}`,
    "> 会话工作本：只写本会话成立的要求与上下文（群规、回复口径、成员角色）；个人评价写人物档案。",
    "",
    "## 这个会话是什么",
    "",
    "## 群内工作要求",
    "",
    "## 成员与角色",
    "",
    "## 本会话结论与待办",
    "",
  ];
  for (const n of notes || []) lines.push(`- ${n}`);
  if (notes && notes.length) lines.push("");
  return lines.join("\n");
}

/** 人物档案模板：四段固定，跨会话复用；不写聊天原文与一次性安排。 */
export function personTemplate(name, platform, personId = "") {
  const label = PLATFORM_LABEL[platform] || platform;
  const lines = [
    `# ${name || personId || "人物"}`,
    "",
    `> ${label} · 人物档案${personId ? ` · ${personId}` : ""}`,
    "> 人物级评价，跨会话复用：只写下次值守还会用到的信息，不保存聊天原文。",
    "",
    "## 身份与角色",
    "",
    "## 沟通偏好",
    "",
    "## 在意与忌讳",
    "",
    "## 历史结论",
    "",
  ];
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

/** Markdown 首个一级标题，用作人物/会话的展示名；没有标题回退 fallback。 */
export function titleOf(text, fallback = "") {
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^#\s+(.+)$/.exec(line.trim());
    if (m) return m[1].trim().slice(0, 80);
  }
  return fallback;
}

const KIND_RANK = { cmd: 0, dm: 0, mention: 0, fyi: 1 };

/**
 * 一批消息里的发言人（确定性）：跳过本人、out、空 sender_id；按「要点名的优先」排序后
 * 去重取前 cap 个。返回 [{id, name}]，路径由调用方按 personRel 拼。
 */
export function personRefs(messages, { selfId = "", cap = 5 } = {}) {
  const self = String(selfId || "");
  const byId = new Map();
  (Array.isArray(messages) ? messages : []).forEach((m, i) => {
    const id = String(m?.sender_id || "");
    if (!id || id === self || m?.kind === "out") return;
    const name = String(m?.sender_name || "").trim() || id.slice(0, 8);
    const rank = KIND_RANK[m?.kind] ?? 1;
    const prev = byId.get(id);
    if (prev) {
      prev.first = Math.min(prev.first, i);
      prev.rank = Math.min(prev.rank, rank);
      return;
    }
    byId.set(id, { id, name, rank, first: i });
  });
  const n = Math.max(1, Number(cap) || 5);
  return [...byId.values()]
    .sort((a, b) => (a.rank - b.rank) || (a.first - b.first))
    .slice(0, n)
    .map(({ id, name }) => ({ id, name }));
}

/**
 * 私聊对方的人物 ID：优先最近一条非本人消息的 sender_id（与群消息同一把钥匙），
 * 没有消息时按平台形态用 chat_id 兜底（飞书 ou_ / 企微单聊 chat_id 就是 userid；
 * 钉钉 senderId ≠ userId，先不兜底，等真机验证）。
 */
const P2P_CHAT_IS_PERSON = {
  feishu: (id) => id.startsWith("ou_"),
  wecom: () => true,
  dingtalk: () => false,
};

export function chatPersonId(platform, chat, selfId = "") {
  if (!chat || chat.kind !== "p2p") return "";
  const self = String(selfId || "");
  for (const m of Array.isArray(chat.recent) ? chat.recent : []) {
    const sid = String(m?.sender_id || "");
    if (sid && sid !== self && m?.kind !== "out") return sid;
  }
  const cid = String(chat.chat_id || "");
  const ok = P2P_CHAT_IS_PERSON[platform];
  return ok && ok(cid) ? cid : "";
}

export class Profiles {
  constructor(dir = process.env.IM_STANDIN_DIR || path.join(os.homedir(), ".im-standin")) {
    this.dir = String(dir).replace(/^~(?=$|\/)/, os.homedir());
    this.root = path.join(this.dir, "profiles");
    this.peopleRoot = path.join(this.root, "people");
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

  personPathFor(platform, personId) {
    const rel = personRel(platform, personId);
    return rel ? this.abs(rel) : "";
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

  /** 人物档案只按需建：GET/列表不调用它，只有明确要写时才 ensure。 */
  ensurePerson(platform, personId, name = "") {
    const file = this.personPathFor(platform, personId);
    if (!file) return { path: "", text: "", mtime: 0, created: false };
    let created = false;
    if (!fs.existsSync(file)) {
      this.ensureDir(path.dirname(file));
      this.writeRaw(file, personTemplate(name, platform, personId));
      created = true;
    }
    return { path: file, text: this.readPath(file), mtime: this.mtime(file), created };
  }

  readPerson(platform, personId, name = "") {
    const file = this.personPathFor(platform, personId);
    if (!file) return { path: "", text: "", mtime: 0, created: false, exists: false };
    if (!fs.existsSync(file)) return { path: file, text: "", mtime: 0, created: false, exists: false };
    return { path: file, text: this.readPath(file), mtime: this.mtime(file), created: false, exists: true };
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
   * 面板覆盖写会话工作本。agent 直接改文件时走自己的文件工具，不经过这里。
   * @returns {{ok: boolean, reason?: string, path?: string, text?: string, mtime?: number}}
   */
  write(platform, chatId, name, text) {
    if (typeof text !== "string") return { ok: false, reason: "text 必须是字符串" };
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAX_PROFILE) return { ok: false, reason: "画像超过 12KB" };
    const file = this.pathFor(platform, chatId, name);
    if (!file) return { ok: false, reason: "画像路径不合法" };
    const body = text.trim() ? text : profileTemplate(name, platform, chatId);
    this.writeRaw(file, body.endsWith("\n") ? body : body + "\n");
    return { ok: true, path: file, text: this.readPath(file), mtime: this.mtime(file) };
  }

  /**
   * 面板覆盖写人物档案。baseMtime 给了且磁盘 mtime 比它新时拒绝（stale），
   * 避免面板草稿覆盖 agent 刚写的内容。
   */
  writePerson(platform, personId, name, text, { baseMtime = 0 } = {}) {
    if (typeof text !== "string") return { ok: false, reason: "text 必须是字符串" };
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAX_PROFILE) return { ok: false, reason: "画像超过 12KB" };
    const file = this.personPathFor(platform, personId);
    if (!file) return { ok: false, reason: "人物 ID 为空或不合法" };
    const base = Number(baseMtime) || 0;
    if (base > 0 && fs.existsSync(file) && this.mtime(file) > base + 0.001) {
      return { ok: false, reason: "stale" };
    }
    const body = text.trim() ? text : personTemplate(name, platform, personId);
    this.writeRaw(file, body.endsWith("\n") ? body : body + "\n");
    return { ok: true, path: file, text: this.readPath(file), mtime: this.mtime(file) };
  }

  /** 扫目录列人物档案；只读、不建文件。platform 为空时扫全部平台。 */
  listPeople(platform = "") {
    const out = [];
    let plats = [];
    if (platform) {
      plats = [safePart(platform) || String(platform || "")];
    } else {
      try {
        plats = fs.readdirSync(this.peopleRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory()).map((d) => d.name);
      } catch {
        return out;
      }
    }
    for (const plat of plats) {
      const dir = path.join(this.peopleRoot, plat);
      let names = [];
      try {
        names = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.endsWith(".history.md"));
      } catch {
        continue;
      }
      for (const name of names) {
        const file = path.join(dir, name);
        const text = this.readPath(file);
        const id = name.slice(0, -3);
        out.push({
          platform: plat,
          person_id: id,
          path: file,
          name: titleOf(text, id),
          text,
          excerpt: excerpt(text),
          mtime: this.mtime(file),
          bytes: Buffer.byteLength(text, "utf8"),
        });
      }
    }
    out.sort((a, b) => (b.mtime - a.mtime) || String(a.name).localeCompare(String(b.name)));
    return out;
  }

  delete(platform, chatId, name = "") {
    const file = this.pathFor(platform, chatId, name);
    if (!file) return false;
    try { fs.unlinkSync(file); return true; } catch { return false; }
  }

  deletePerson(platform, personId) {
    const file = this.personPathFor(platform, personId);
    if (!file) return false;
    try { fs.unlinkSync(file); return true; } catch { return false; }
  }
}
