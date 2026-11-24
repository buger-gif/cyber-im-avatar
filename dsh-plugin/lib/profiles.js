/**
 * profiles.js — 画像文件：群两层（人物档案 + 会话工作本），单聊只有对方的人物档案一份。
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
/** 发言权小节的正文上限：它是授权边界，不是作文。 */
export const MAX_RIGHTS = 8 * 1024;
/** 发言权小节标题：插件建模板时就写进去，人填、agent 首任代笔；判定只看这段是否非空。 */
export const RIGHTS_TITLE = "## 我在这个群的发言权";
/**
 * 默认发言权：每个群一上来就按它跑，用户不用写、也不用开。
 * 工作本那一段为空（或没写）就等于用默认；写了就覆盖默认——只有一个覆盖点。
 */
export const RIGHTS_DEFAULT = [
  "- 默认：沉默。没有需要我出手的具体事，就不发",
  "- 发言门槛：有对方还不知道、且会改变他动作的信息（新结论 / 新进度 / 新事实 / 交付物 / " +
    "明确卡点），或有人在问我、要我表态",
  "- 机器消息（告警、催办卡、自动通知）不算叫我干活：@ 常是角色字段（处理人 / 跟进人 / " +
    "知会人），先看正文实际要谁做什么，指向别人就只当知会、不代答",
  "- 不重复：机器人刚发过的、卡片里写着的、我说过的都不算增量；不补欢迎语、自我介绍、" +
    "「有问题找我」，平台已经催过的事不跟催",
  "- 轮到我出手的节点才发（截止已过、状态变了、对方承诺的时间过了、要我拍板），只说新增部分",
  "- 判不准：沉默；沉默不发群，只记日报",
].join("\n");
const PLATFORM_LABEL = { feishu: "飞书", wecom: "企业微信", dingtalk: "钉钉" };
const SAFE = /[^0-9A-Za-z._\-\u4e00-\u9fff]+/g;
const H2 = /^##\s+\S/;

/**
 * 取工作本里发言权小节的 body（标题行到下一个二级标题为止）。
 * 只做结构切分，不解析语义：`defined` = body 去空白后非空；标题被删也算未定义（fail-closed）。
 */
export function rightsSection(text) {
  const lines = String(text == null ? "" : text).replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((l) => l.trim() === RIGHTS_TITLE);
  if (at < 0) return { found: false, defined: false, body: "" };
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (H2.test(lines[i])) { end = i; break; }
  }
  const body = lines.slice(at + 1, end).join("\n").trim();
  return { found: true, defined: !!body, body };
}

/**
 * 只替换发言权小节的 body：标题之前、下一个二级标题之后的字节原样保留。
 * 标题缺失时在文末补回（插件是模板作者，能重建），不碰其它段落。
 */
export function setRightsSection(text, body) {
  const src = String(text == null ? "" : text).replace(/\r\n/g, "\n");
  const clean = String(body == null ? "" : body).replace(/\r\n/g, "\n").trim();
  const block = clean ? `${RIGHTS_TITLE}\n\n${clean}\n` : `${RIGHTS_TITLE}\n`;
  const lines = src.split("\n");
  const at = lines.findIndex((l) => l.trim() === RIGHTS_TITLE);
  if (at < 0) {
    const head = src.trim() ? (src.endsWith("\n") ? src : `${src}\n`) : "";
    return head + (head ? "\n" : "") + block;
  }
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (H2.test(lines[i])) { end = i; break; }
  }
  const before = lines.slice(0, at).join("\n");
  const after = lines.slice(end).join("\n");
  const parts = [];
  if (before.trim()) parts.push(before);
  parts.push(block);
  if (after.trim()) parts.push(after);
  let out = parts.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  if (!after.trim()) out = out.replace(/\n+$/, "\n");
  return out;
}

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
    RIGHTS_TITLE,
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
    // out = 本人发的；cmd = 本人 @ 自己（spec 0029 / 0039），都不是「对面那个人」。
    // 后者尤其重要：selfId 暂时取不到时，cmd 的 sender 就是本人，不能拿来建人物档案。
    if (sid && sid !== self && m?.kind !== "out" && m?.kind !== "cmd") return sid;
  }
  const cid = String(chat.chat_id || "");
  const ok = P2P_CHAT_IS_PERSON[platform];
  return ok && ok(cid) ? cid : "";
}

/**
 * 会话的记忆文件：私聊只有对方的人物档案一份；群才是会话工作本 + 人物档案。
 * 私聊推不出对方 ID（钉钉 senderId 未验证；飞书 oc_ 且还没有消息）时退回会话工作本，
 * 保持旧行为——宁可多一份兜底，也不静默把内容写到错的人身上。
 */
export function memoryRel(platform, chat, selfId = "") {
  if (chat?.kind === "p2p") {
    const personId = chatPersonId(platform, chat, selfId);
    // 人物 ID 全是非法字符（sanitize 后为空）时不能给空路径，退回工作本兜底。
    const rel = personId ? personRel(platform, personId) : "";
    if (rel) return { rel, personId, single: true };
  }
  return { rel: profileRel(platform, chat?.chat_id, chat?.name), personId: "", single: false };
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

  /** 会话的记忆文件：单聊＝对方人物档案一份；群＝会话工作本（路径规则见 memoryRel）。 */
  memoryFor(platform, chat, selfId = "") {
    const m = memoryRel(platform, chat, selfId);
    return { path: this.abs(m.rel), person_id: m.personId, single: m.single, rel: m.rel };
  }

  /** 旧版私聊工作本：只作为待并入的存量给路径；群、或记忆已经是这份文件时返回空。 */
  legacyBookFor(platform, chat, selfId = "") {
    if (!chat || chat.kind !== "p2p") return "";
    const file = this.pathFor(platform, chat.chat_id, chat.name);
    if (!file) return "";
    const m = this.memoryFor(platform, chat, selfId);
    if (!m.single || file === m.path) return "";
    return String(this.readPath(file)).trim() ? file : "";
  }

  historyPathFor(file) {
    const f = String(file || "");
    if (!f) return "";
    return /\.md$/i.test(f) ? `${f.slice(0, -3)}.history.md` : `${f}.history.md`;
  }

  /**
   * 确保会话记忆文件存在。单聊第一次被面板/值守碰到时，若人物档案还不存在、旧会话工作本
   * 有内容，就把它整文件搬过来（不改写、不拆段，内容一字不丢）；已经有档案就不动旧文件，
   * 留给 agent 按载荷的「待并入」行合并。
   */
  ensureMemory(platform, chat, selfId = "") {
    const memory = this.memoryFor(platform, chat, selfId);
    if (!memory.path) return { path: "", text: "", mtime: 0, created: false };
    if (memory.single) {
      if (!fs.existsSync(memory.path)) {
        const legacy = this.legacyBookFor(platform, chat, selfId);
        if (legacy) {
          try {
            // 旧文件还是没写过内容的模板：直接删掉，按人物档案模板重建，不留第二份。
            // 有内容的才整文件搬，原文字一个不改，归并交给 agent。
            const template = profileTemplate(chat?.name || "", platform, chat?.chat_id || "");
            if (this.readPath(legacy) === template) {
              fs.unlinkSync(legacy);
            } else {
              this.ensureDir(path.dirname(memory.path));
              // 复制而不是 rename：另一路（agent / 另一个面板请求）可能刚好建好了人物档案，
              // COPYFILE_EXCL 保证不覆盖它；搬完再删旧文件，删不掉就回滚复制，避免两份并存。
              fs.copyFileSync(legacy, memory.path, fs.constants.COPYFILE_EXCL);
              try { fs.chmodSync(memory.path, 0o600); } catch { /* best effort */ }
              try {
                fs.unlinkSync(legacy);
              } catch (e) {
                try { fs.unlinkSync(memory.path); } catch { /* best effort */ }
                throw e;
              }
            }
          } catch { /* 搬不动就保留旧文件，由载荷的「待并入」行兜底 */ }
        }
      }
      return this.ensurePerson(platform, memory.person_id, chat?.name || "");
    }
    return this.ensure(platform, chat?.chat_id, chat?.name || "");
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

  /**
   * 群的发言权（工作本里那一段）。私聊不适用，按「已定义」返回——对方的私聊没有授权边界可言。
   * 只读文件、只做结构切分，不看语义（铁律 8）。
   */
  rightsFor(platform, chat, selfId = "") {
    const memory = this.memoryFor(platform, chat, selfId);
    const plain = {
      path: memory.path || "", exists: false, custom: false, text: RIGHTS_DEFAULT,
      title: RIGHTS_TITLE, mtime: 0, applicable: false, default_text: RIGHTS_DEFAULT,
    };
    if (!memory.path) return plain;
    if (chat?.kind !== "group" || memory.single) return plain;
    const exists = fs.existsSync(memory.path);
    const sec = rightsSection(exists ? this.readPath(memory.path) : "");
    // 空段 = 用默认口径，不是「没定义」：默认值必须有，用户不需要为它做任何事。
    return {
      ...plain, exists, custom: sec.defined, text: sec.defined ? sec.body : RIGHTS_DEFAULT,
      mtime: this.mtime(memory.path), applicable: true,
    };
  }

  /**
   * 面板改发言权：只替换工作本里那一段，其余字节原样保留。
   * baseMtime 给了且磁盘比它新时回 stale（沿用面板编辑模型的冲突语义），不静默覆盖。
   */
  writeRights(platform, chat, selfId, body, { baseMtime = 0 } = {}) {
    if (!chat || chat.kind !== "group") return { ok: false, reason: "single_chat" };
    if (typeof body !== "string") return { ok: false, reason: "text 必须是字符串" };
    if (Buffer.byteLength(body, "utf8") > MAX_RIGHTS) {
      return { ok: false, reason: "发言权超过 8KB" };
    }
    const memory = this.memoryFor(platform, chat, selfId);
    if (!memory.path) return { ok: false, reason: "画像路径不合法" };
    const base = Number(baseMtime) || 0;
    if (base > 0 && fs.existsSync(memory.path) && this.mtime(memory.path) > base + 0.001) {
      return { ok: false, reason: "stale" };
    }
    // 文件还不存在时按模板建一份（模板自带空小节），其余段落不凭空捏造。
    const current = fs.existsSync(memory.path)
      ? this.readPath(memory.path)
      : profileTemplate(chat.name || "", platform, chat.chat_id || "");
    const next = setRightsSection(current, body);
    if (Buffer.byteLength(next, "utf8") > MAX_PROFILE) {
      return { ok: false, reason: "画像超过 12KB" };
    }
    this.writeRaw(memory.path, next.endsWith("\n") ? next : `${next}\n`);
    const sec = rightsSection(this.readPath(memory.path));
    // 写空 = 恢复默认口径（该段清空），不是「关掉闸门」。
    return {
      ok: true, path: memory.path, custom: sec.defined,
      text: sec.defined ? sec.body : RIGHTS_DEFAULT,
      title: RIGHTS_TITLE, default_text: RIGHTS_DEFAULT, mtime: this.mtime(memory.path),
    };
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
