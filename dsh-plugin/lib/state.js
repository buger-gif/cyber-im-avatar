/**
 * state.js — 插件唯一的本地状态：~/.im-standin/state.json。
 *
 * 这是一个 skill 壳，不是 IM 客户端：
 *   · 值守名单、工作区、DSH 会话、最近一次 turn 结果放在这里；
 *   · 每个会话只缓存最近 10 条消息（面板预览 + 唤醒 prompt 用），
 *     更早的正文/历史去找平台在线查；
 *   · 不建 SQLite，不保存发送历史。
 *
 * 一个 DSH 宿主进程写这个文件；写入走临时文件 + rename，保留 .bak。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MIN_INTERVAL_MIN = 10;
export const MAX_INTERVAL_MIN = 240;
export const RECENT_LIMIT = 10;
/** 插件壳支持的平台；config.platforms 是启用开关，缺省只开飞书 / 企微。 */
export const SUPPORTED_PLATFORMS = ["feishu", "wecom", "dingtalk"];
const DM_SCOPES = ["recent", "all", "watched"];
/** 群唤醒策略：mention=只 @ 唤醒；all=非 @ 也进批次（只看不回）。 */
export const WAKE_MODES = ["mention", "all"];

export const DEFAULT_CONFIG = {
  poll: {
    interval_min: MIN_INTERVAL_MIN,
    fast_sec: 60,
    dm_scope: "recent",
    dm_recent: 20,
    per_chat_limit: 10,
    backfill_hours: 72,
    refresh_chatlist: true,
    cooldown_sec: 20,
    group_wake_sec: 60,
  },
  platforms: ["feishu", "wecom"],
  dsh: { timeout: 600, full_access: false },
};

/** 退役配置键：旧 panel.json 里有，也不许混进运行配置。 */
export const RETIRED_KEYS = ["llm", "reply", "reply_guard", "ui", "seed_targets"];

export function defaultState() {
  return {
    version: 1,
    config: clone(DEFAULT_CONFIG),
    paused: false,
    runtime: { cycles: 0, last_cycle_at: 0, last_cycle_ms: 0, last_result: {} },
    chats: {},
  };
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function int(v, lo, hi, fallback) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function normalizeConfig(input) {
  const cfg = clone(DEFAULT_CONFIG);
  if (input && typeof input === "object") {
    const src = clone(input);
    const poll = src.poll && typeof src.poll === "object" ? src.poll : {};
    // 0.3.0 之前的秒级配置：只翻译，不把老键带进运行配置。
    if (poll.interval_min == null && src.poll_interval != null) {
      poll.interval_min = Math.ceil((Number(src.poll_interval) || 0) / 60);
    }
    if (poll.dm_recent == null && src.recent_chats != null) poll.dm_recent = src.recent_chats;
    if (poll.per_chat_limit == null && src.per_chat_limit != null) poll.per_chat_limit = src.per_chat_limit;
    if (poll.backfill_hours == null && src.backfill_hours != null) poll.backfill_hours = src.backfill_hours;
    if (poll.dm_scope == null && src.poll_watched_only === true) poll.dm_scope = "watched";
    src.poll = poll;
    for (const k of ["poll_interval", "recent_chats", "per_chat_limit", "backfill_hours",
      "poll_watched_only", "chatlist_interval", "port"]) delete src[k];
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === "object" && !Array.isArray(v) && cfg[k] && typeof cfg[k] === "object") {
        cfg[k] = { ...cfg[k], ...v };
      } else {
        cfg[k] = v;
      }
    }
  }
  const p = cfg.poll || (cfg.poll = {});
  p.interval_min = int(p.interval_min, MIN_INTERVAL_MIN, MAX_INTERVAL_MIN, MIN_INTERVAL_MIN);
  // 快车道：0=关闭；非 0 时抬到 ≥20，且不超过慢车道间隔。
  p.fast_sec = int(p.fast_sec, 0, 600, 60);
  if (p.fast_sec > 0) {
    p.fast_sec = Math.max(20, Math.min(p.fast_sec, p.interval_min * 60));
  }
  p.dm_recent = int(p.dm_recent, 1, 200, 20);
  p.per_chat_limit = int(p.per_chat_limit, 1, 50, 10);
  p.backfill_hours = int(p.backfill_hours, 0, 24 * 30, 72);
  p.cooldown_sec = int(p.cooldown_sec, 0, 600, 20);
  p.group_wake_sec = int(p.group_wake_sec, 0, 3600, 60);
  if (!DM_SCOPES.includes(p.dm_scope)) p.dm_scope = "recent";
  p.refresh_chatlist = p.refresh_chatlist !== false;
  const d = cfg.dsh || (cfg.dsh = {});
  d.timeout = int(d.timeout, 30, 3600, 600);
  d.full_access = d.full_access === true || d.full_access === "true" || d.full_access === 1;
  if (!Array.isArray(cfg.platforms) || cfg.platforms.length === 0) cfg.platforms = ["feishu", "wecom"];
  cfg.platforms = cfg.platforms
    .filter((x) => typeof x === "string" && x)
    .filter((x) => SUPPORTED_PLATFORMS.includes(x));
  // 退役键：不让它们从旧 panel.json 混进运行配置。
  for (const k of RETIRED_KEYS) delete cfg[k];
  if (cfg.dsh) {
    delete cfg.dsh.profile;
    delete cfg.dsh.pre_draft;
  }
  return cfg;
}

export function publicConfig(cfg, hostReady = false) {
  const out = clone(normalizeConfig(cfg));
  out.poll.interval_sec = out.poll.interval_min * 60;
  out.poll.min_interval_min = MIN_INTERVAL_MIN;
  out.poll.max_interval_min = MAX_INTERVAL_MIN;
  out.poll.min_fast_sec = 20;
  out.poll.max_fast_sec = 600;
  out.resolved = {
    dsh_ready: !!hostReady,
    label: hostReady ? "跟随 DSH 配置" : "DSH 宿主未就绪",
  };
  return out;
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const RECENT_KINDS = ["dm", "mention", "service", "fyi", "out"];
const RECENT_STATES = ["new", "opened", "replied", "ignored"];

/**
 * 一条消息指针的归一化。字段顺序就是契约 02 的顺序：新字段只能往后追加。
 * media_paths 只存插件下载后的本地绝对路径，不存二进制。
 */
function normalizeMessage(m) {
  const kind = RECENT_KINDS.includes(m.kind) ? m.kind : "fyi";
  const state = RECENT_STATES.includes(m.state) ? m.state : "new";
  // 正文只在「还没处理」时保留；全量模式的 fyi 也要能带给 agent，
  // 所以按 state 收口而不是按 kind。mention 模式下 fyi 恒为 ignored，不会多存。
  const keepBody = (state === "new" || state === "opened") && kind !== "out";
  return {
    msg_id: String(m.msg_id),
    sender_id: String(m.sender_id || ""),
    sender_name: String(m.sender_name || ""),
    content: keepBody ? String(m.content || "") : "",
    ts: String(m.ts || ""),
    ts_epoch: Number(m.ts_epoch) || 0,
    kind,
    state,
    msg_type: String(m.msg_type || ""),
    app_link: String(m.app_link || ""),
    media_id: String(m.media_id || ""),
    media_paths: (Array.isArray(m.media_paths) ? m.media_paths : [])
      .filter((p) => typeof p === "string" && p && path.isAbsolute(p)),
  };
}

export class State {
  constructor(dir = process.env.IM_STANDIN_DIR || path.join(os.homedir(), ".im-standin")) {
    this.dir = String(dir).replace(/^~(?=$|\/)/, os.homedir());
    this.statePath = path.join(this.dir, "state.json");
    this.bakPath = path.join(this.dir, "state.json.bak");
    this.data = defaultState();
    this.loaded = false;
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.dir, 0o700); } catch { /* best effort */ }
  }

  load() {
    this.ensureDir();
    let raw = safeReadJson(this.statePath);
    if (!raw) raw = safeReadJson(this.bakPath);
    const base = defaultState();
    if (raw && typeof raw === "object") {
      base.config = normalizeConfig(raw.config);
      base.paused = !!raw.paused;
      base.runtime = { ...base.runtime, ...(raw.runtime || {}) };
      base.chats = {};
      for (const [key, chat] of Object.entries(raw.chats || {})) {
        const c = this.normalizeChat(chat);
        if (c) base.chats[key] = c;
      }
      base.version = 1;
    }
    this.data = base;
    // 上一次进程在 turn 中途退出：不能假装成功，也不能永远挂着。
    for (const chat of Object.values(this.data.chats)) {
      if (chat.wake?.active) {
        chat.wake.active = false;
        chat.wake.failed = true;
        chat.last_turn = { ok: false, reason: "restarted", at: Date.now() / 1000 };
        chat.last_error = "进程重启：上一轮 turn 未完成";
      }
    }
    this.loaded = true;
    return this.data;
  }

  save() {
    if (!this.loaded) this.load();
    this.ensureDir();
    const text = JSON.stringify(this.data, null, 2) + "\n";
    try {
      if (fs.existsSync(this.statePath)) {
        fs.copyFileSync(this.statePath, this.bakPath);
        try { fs.chmodSync(this.bakPath, 0o600); } catch { /* best effort */ }
      }
    } catch { /* backup is best effort */ }
    const tmp = this.statePath + ".tmp." + process.pid + "." + Date.now();
    try {
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, this.statePath);
    } finally {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best effort */ }
    }
    try { fs.chmodSync(this.statePath, 0o600); } catch { /* best effort */ }
  }

  normalizeChat(input) {
    if (!input || !input.platform || !input.chat_id) return null;
    const platform = String(input.platform);
    const chatId = String(input.chat_id);
    const key = chatKey(platform, chatId);
    const chat = {
      platform,
      chat_id: chatId,
      name: String(input.name || chatId),
      kind: input.kind === "group" ? "group" : "p2p",
      target: !!input.target,
      watching: !!input.watching,
      blocked: !!input.blocked,
      blocked_at: Number(input.blocked_at) || 0,
      timer: Number.isFinite(Number(input.timer))
        ? Number(input.timer)
        : (input.kind === "group" ? -1 : 0),
      // 群唤醒策略：缺省 mention = 现状，老数据不会突然开始全量唤醒。
      wake_mode: WAKE_MODES.includes(input.wake_mode) ? input.wake_mode : "mention",
      last_wake_at: Number(input.last_wake_at) || 0,
      last_wake_epoch: Number(input.last_wake_epoch) || 0,
      workspace: typeof input.workspace === "string" ? input.workspace : "",
      dsh_session: typeof input.dsh_session === "string" ? input.dsh_session : "",
      session_turns: Math.max(0, Number(input.session_turns) || 0),
      session_bound_at: Number(input.session_bound_at) || 0,
      last_epoch: Number(input.last_epoch) || 0,
      last_ts: typeof input.last_ts === "string" ? input.last_ts : "",
      last_msg_id: typeof input.last_msg_id === "string" ? input.last_msg_id : "",
      last_sync: Number(input.last_sync) || 0,
      last_error: typeof input.last_error === "string" ? input.last_error : "",
      last_turn: input.last_turn && typeof input.last_turn === "object"
        ? { ok: input.last_turn.ok ?? null, reason: input.last_turn.reason || "", at: Number(input.last_turn.at) || 0 }
        : { ok: null, reason: "", at: 0 },
      wake: input.wake && typeof input.wake === "object"
        ? { at: Number(input.wake.at) || 0, failed: !!input.wake.failed, turn_id: input.wake.turn_id || "", active: !!input.wake.active }
        : { at: 0, failed: false, turn_id: "", active: false },
      added_at: Number(input.added_at) || 0,
      recent: [],
      prompt_session: typeof input.prompt_session === "string" ? input.prompt_session : "",
    };
    const seen = new Set();
    for (const m of (Array.isArray(input.recent) ? input.recent : [])) {
      if (!m || !m.msg_id || seen.has(m.msg_id)) continue;
      seen.add(m.msg_id);
      chat.recent.push(normalizeMessage(m));
    }
    chat.recent.sort((a, b) => (b.ts_epoch - a.ts_epoch) || String(b.msg_id).localeCompare(String(a.msg_id)));
    chat.recent = chat.recent.slice(0, RECENT_LIMIT);
    return chat;
  }

  get chatMap() {
    return this.data.chats;
  }

  getChat(platform, chatId) {
    return this.data.chats[chatKey(platform, chatId)] || null;
  }

  ensureChat(platform, chatId, { name, kind, target = false } = {}) {
    const key = chatKey(platform, chatId);
    let chat = this.data.chats[key];
    if (!chat) {
      const nextKind = kind === "group" ? "group" : "p2p";
      chat = this.normalizeChat({
        platform, chat_id: chatId,
        name: target ? this.uniqueName(platform, name || chatId, chatId) : (name || chatId),
        kind: nextKind, target, watching: false,
        timer: nextKind === "group" ? -1 : 0,
        added_at: Date.now() / 1000,
      });
      this.data.chats[key] = chat;
      return chat;
    }
    if (name) {
      const desired = target ? this.uniqueName(platform, name, chatId) : String(name);
      if (desired && desired !== chat.name) chat.name = desired;
    }
    if (kind) chat.kind = kind === "group" ? "group" : "p2p";
    if (target) chat.target = true;
    return chat;
  }

  uniqueName(platform, desired, chatId) {
    const base = String(desired || chatId || "服务对象").trim() || chatId;
    const taken = new Set(
      Object.values(this.data.chats)
        .filter((c) => c.platform === platform && c.chat_id !== chatId)
        .map((c) => c.name),
    );
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base} (${i})`)) i += 1;
    return `${base} (${i})`;
  }

  listChats({ watchedOnly = false } = {}) {
    return Object.values(this.data.chats)
      .filter((c) => !watchedOnly || c.watching)
      .sort((a, b) => (Number(b.watching) - Number(a.watching)) ||
        ((b.last_epoch || 0) - (a.last_epoch || 0)));
  }

  serviceChats() {
    return this.listChats().filter((c) => c.watching && !c.blocked);
  }

  pendingMessages(chat, limit = RECENT_LIMIT) {
    return (chat?.recent || [])
      .filter((m) => isPendingMessage(m, chat))
      .sort((a, b) => (a.ts_epoch - b.ts_epoch))
      .slice(-Math.max(1, limit));
  }

  pendingCount(chat) {
    return (chat?.recent || []).filter((m) => isPendingMessage(m, chat)).length;
  }

  counts() {
    const out = { unread: 0, todo: 0, unread_dm: 0, unread_mention: 0 };
    for (const chat of Object.values(this.data.chats)) {
      if (chat.blocked) continue;
      for (const m of chat.recent) {
        if (!isPendingMessage(m, chat)) continue;
        if (m.state === "new") {
          out.unread += 1;
          if (m.kind === "dm") out.unread_dm += 1;
          if (m.kind === "mention") out.unread_mention += 1;
        }
        if (m.state === "new" || m.state === "opened") out.todo += 1;
      }
    }
    return out;
  }

  setMessageState(platform, msgId, state, chatId = "") {
    const wanted = chatId ? [this.getChat(platform, chatId)].filter(Boolean) : this.listChats();
    for (const chat of wanted) {
      const m = chat.recent.find((x) => x.msg_id === msgId);
      if (!m) continue;
      m.state = state;
      if (state === "replied" || state === "ignored") m.content = "";
      this.save();
      return { ok: true, chat, message: m };
    }
    return { ok: false, reason: "not_cached" };
  }

  markEarlierReplied(chat, epoch) {
    let n = 0;
    for (const m of chat.recent) {
      if (m.ts_epoch >= epoch) continue;
      if (!(m.kind === "dm" || m.kind === "mention" || m.kind === "service")) continue;
      if (!(m.state === "new" || m.state === "opened")) continue;
      m.state = "replied";
      m.content = "";
      n += 1;
    }
    return n;
  }

  mergeRecent(chat, messages) {
    const byId = new Map(chat.recent.map((m) => [m.msg_id, m]));
    for (const raw of messages) {
      if (!raw || !raw.msg_id) continue;
      const id = String(raw.msg_id);
      const next = normalizeMessage(raw);
      const cur = byId.get(id);
      if (!cur) {
        byId.set(id, next);
        continue;
      }
      // 已有指针只补空着的媒体元数据，不回退 state/content 的判定。
      if (!cur.msg_type && next.msg_type) cur.msg_type = next.msg_type;
      if (!cur.app_link && next.app_link) cur.app_link = next.app_link;
      if (!cur.media_id && next.media_id) cur.media_id = next.media_id;
      if ((!cur.media_paths || !cur.media_paths.length) && next.media_paths.length) {
        cur.media_paths = next.media_paths;
      }
    }
    chat.recent = [...byId.values()]
      .sort((a, b) => (b.ts_epoch - a.ts_epoch) || String(b.msg_id).localeCompare(String(a.msg_id)))
      .slice(0, RECENT_LIMIT);
    return chat.recent;
  }

  /**
   * 清掉 recent.media_paths 里已经不存在的文件（媒体清理/用户手删之后）。
   * 不传 paths 就检查全部；返回是否有改动。
   */
  pruneMediaPaths(paths = null) {
    const wanted = paths ? new Set(paths) : null;
    let changed = false;
    for (const chat of Object.values(this.data.chats)) {
      for (const m of chat.recent) {
        const list = Array.isArray(m.media_paths) ? m.media_paths : [];
        if (!list.length) continue;
        const kept = list.filter((p) => {
          if (wanted && !wanted.has(p)) return true;
          try { return fs.existsSync(p); } catch { return false; }
        });
        if (kept.length !== list.length) {
          m.media_paths = kept;
          changed = true;
        }
      }
    }
    if (changed) this.save();
    return changed;
  }

  inboxGroups(kind = "todo", limit = 40, preview = 3) {
    const groups = [];
    for (const chat of Object.values(this.data.chats)) {
      if (chat.blocked) continue;
      const matches = (chat.recent || []).filter((m) => messageMatches(m, kind));
      if (!matches.length) continue;
      const latestFirst = matches.slice().sort((a, b) => (b.ts_epoch - a.ts_epoch));
      const last = latestFirst[0];
      groups.push({
        platform: chat.platform,
        chat_id: chat.chat_id,
        chat_name: chat.name || chat.chat_id,
        chat_kind: chat.kind,
        chat_mode: "monitor",
        count: matches.length,
        unread: matches.filter((m) => m.state === "new").length,
        last_epoch: last.ts_epoch || 0,
        ts: last.ts || "",
        msg_id: last.msg_id || "",
        sender_name: last.sender_name || "",
        content: last.content || "",
        msg_type: last.msg_type || "",
        app_link: last.app_link || "",
        kinds: [...new Set(matches.map((m) => m.kind))],
        preview: latestFirst.slice(0, preview).map((m) => ({ ...m })),
      });
    }
    groups.sort((a, b) => (b.last_epoch - a.last_epoch));
    return groups.slice(0, Math.max(1, Math.min(limit, 200)));
  }

  inboxRows(kind = "all", limit = 60) {
    const rows = [];
    for (const chat of Object.values(this.data.chats)) {
      if (chat.blocked) continue;
      for (const m of chat.recent) {
        if (!messageMatches(m, kind)) continue;
        rows.push({
          ...m,
          chat_name: chat.name || chat.chat_id,
          chat_kind: chat.kind,
          chat_mode: "monitor",
        });
      }
    }
    rows.sort((a, b) => (b.ts_epoch - a.ts_epoch));
    return rows.slice(0, Math.max(1, limit));
  }

  threadLocal(platform, chatId, limit = 30) {
    const chat = this.getChat(platform, chatId);
    if (!chat) return [];
    return chat.recent.slice().sort((a, b) => (a.ts_epoch - b.ts_epoch)).slice(-Math.max(1, limit));
  }

  ignoreUnwatched() {
    let n = 0;
    for (const chat of Object.values(this.data.chats)) {
      if (chat.watching) continue;
      for (const m of chat.recent) {
        if (!(m.kind === "dm" || m.kind === "mention" || m.kind === "service")) continue;
        if (!(m.state === "new" || m.state === "opened")) continue;
        m.state = "ignored";
        m.content = "";
        n += 1;
      }
    }
    if (n) this.save();
    return n;
  }

  deleteChat(platform, chatId) {
    const key = chatKey(platform, chatId);
    const chat = this.data.chats[key] || null;
    if (chat) delete this.data.chats[key];
    this.save();
    return chat;
  }

  setSession(chat, sessionId) {
    const sid = String(sessionId || "");
    if (sid !== (chat.dsh_session || "")) {
      chat.dsh_session = sid;
      chat.session_bound_at = sid ? Date.now() / 1000 : 0;
      chat.session_turns = 0;
      chat.prompt_session = "";
    }
    this.save();
  }

  bumpTurn(chat, ok, reason = "") {
    chat.wake.active = false;
    chat.wake.failed = !ok;
    chat.wake.turn_id = "";
    chat.last_turn = { ok: !!ok, reason: ok ? "" : (reason || ""), at: Date.now() / 1000 };
    if (ok) chat.session_turns = (chat.session_turns || 0) + 1;
    if (!ok && reason) chat.last_error = reason;
    this.save();
  }
}

export function chatKey(platform, chatId) {
  return `${platform}:${chatId}`;
}

/**
 * 一条消息算不算「待回」。待回口径一处定义：
 * 私聊/点名/服务消息，以及全量模式群里的非点名消息。
 */
export function isPendingMessage(m, chat = null) {
  if (!m) return false;
  if (!(m.state === "new" || m.state === "opened")) return false;
  if (m.kind === "dm" || m.kind === "mention" || m.kind === "service") return true;
  return !!chat && chat.kind === "group" && chat.wake_mode === "all" && m.kind === "fyi";
}

export function messageMatches(m, kind) {
  if (kind === "dm") return m.kind === "dm";
  if (kind === "mention") return m.kind === "mention";
  if (kind === "service") return m.kind === "service";
  if (kind === "todo") return (m.kind === "dm" || m.kind === "mention" || m.kind === "service") &&
    (m.state === "new" || m.state === "opened");
  if (kind === "unread") return (m.kind === "dm" || m.kind === "mention" || m.kind === "service") &&
    m.state === "new";
  return true;
}
