/**
 * progress.js — 私聊进度卡（spec 0052）。
 *
 * 设计原则：卡片首先要能证明“真的在干活”。最可靠的证据是 agent 实际发生的
 * tool call 计数，而不是“正在处理”这种状态词。计数只按工具名归到四类：
 * 查资料 / 改文件 / 执行操作 / 并行处理；不读参数、结果、命令、路径。
 *
 * `[进度]` 标记是可选增强：有就补任务级“现在/接着/第几步”，没有也仍有计数。
 * 卡片由本人身份发 Card 2.0（im.sendCard 走 --as user），本模块不碰 bot。
 */
import crypto from "node:crypto";

import { chatKey } from "./state.js";

export const CREATE_DELAY_MS = 2 * 60 * 1000;
export const EVENT_PATCH_DELAY_MS = 1_500;
export const REUSE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_LABEL = 60;

const COUNT_KEYS = ["research", "files", "ops", "parallel"];
const COUNT_LABELS = {
  research: "查资料",
  files: "改文件",
  ops: "执行操作",
  parallel: "并行处理",
};

function nowMs(now) {
  const n = Number(now());
  return Number.isFinite(n) ? n : Date.now();
}

export function formatDuration(ms) {
  const sec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  if (min < 60) return rest ? `${min} 分 ${rest} 秒` : `${min} 分`;
  const hour = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${hour} 小时 ${m} 分` : `${hour} 小时`;
}

/** 工具名 → 固定分类；只读 name，不读 arguments/结果。 */
export function actionCategory(name) {
  const s = String(name || "").toLowerCase();
  if (/(todo)/.test(s)) return "";
  if (/(web_search|web_fetch|search|read|glob|grep|list|skill)/.test(s)) return "research";
  if (/(write|edit|apply_patch)/.test(s)) return "files";
  if (/(subagent|workflow)/.test(s)) return "parallel";
  return "ops";
}

export function emptyCounts() {
  return { research: 0, files: 0, ops: 0, parallel: 0 };
}

export function normalizeCounts(input) {
  const out = emptyCounts();
  for (const k of COUNT_KEYS) out[k] = Math.max(0, Number(input?.[k]) || 0);
  return out;
}

export function addAction(counts, name) {
  const cat = actionCategory(name);
  if (cat) counts[cat] += 1;
  return counts;
}

export function countsLine(counts) {
  const c = normalizeCounts(counts);
  const parts = COUNT_KEYS.filter((k) => c[k] > 0).map((k) => `${COUNT_LABELS[k]} ${c[k]} 次`);
  return parts.length ? `已做：${parts.join(" · ")}` : "已做：正在准备";
}

function unsafeLabel(text) {
  const s = String(text || "");
  if (!s) return true;
  if (/https?:\/\/|www\.|:\/\//i.test(s)) return true;
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(s)) return true;
  if (/(^|\s)@/.test(s)) return true;
  if (/(^|\s)(\/|~\/|[A-Za-z]:\\)/.test(s)) return true;
  if (/(^|\s)\.\.?(\/|\\)/.test(s)) return true;
  if (/\b(?:oc|ou|om|cli|sk|ak|aib|wo)_[A-Za-z0-9_-]{6,}\b/i.test(s)) return true;
  if (/\b\d{6,}\b/.test(s)) return true;
  if (/`|~~~|<\/?[A-Za-z][^>]*>|\{\{/.test(s)) return true;
  if (/\b[a-f0-9]{24,}\b/i.test(s)) return true;
  if (/\b[A-Za-z0-9+/=]{32,}\b/.test(s)) return true;
  return false;
}

export function sanitizeLabel(value) {
  let text = String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const chars = [...text];
  if (chars.length > MAX_LABEL) text = chars.slice(0, MAX_LABEL).join("") + "…";
  return unsafeLabel(text) ? "" : text;
}

/**
 * 解析 `[进度] 2/5 现在：...；接着：...`。只返回通过过滤的任务级标签；
 * 多行取最后一条有效；没有有效标记返回 null。
 */
export function parseProgressLine(text) {
  const lines = String(text || "").split(/\r?\n/);
  let best = null;
  for (const line of lines) {
    const m = line.match(/^\s*\[进度\]\s*(.*)$/u);
    if (!m) continue;
    const parsed = parseMarker(m[1]);
    if (parsed) best = parsed;
  }
  return best;
}

function parseMarker(raw) {
  let rest = String(raw || "").trim();
  if (!rest) return null;
  let step = null;
  const sm = rest.match(/^(\d{1,2})\s*\/\s*(\d{1,2})(?:\s+|$)/);
  if (sm) {
    const n = Number(sm[1]);
    const total = Number(sm[2]);
    if (n >= 1 && n <= 99 && total >= 1 && total <= 99 && n <= total) {
      step = { n, total };
    }
    rest = rest.slice(sm[0].length).trim();
  }
  const parts = rest.split(/[；;|]/).map((x) => x.trim()).filter(Boolean);
  let now = "";
  let next = "";
  let labeled = false;
  for (const part of parts) {
    const m = part.match(/^(现在|接着|下一步)\s*[：:]\s*(.+)$/u);
    if (!m) continue;
    labeled = true;
    const label = sanitizeLabel(m[2]);
    if (!label) continue;
    if (m[1] === "现在") now = label;
    else next = label;
  }
  if (!labeled) {
    const label = sanitizeLabel(rest);
    if (label) now = label;
  }
  if (!now && !next) return null;
  return { now, next, step };
}

function extractText(data) {
  const msg = data && typeof data === "object" ? data.message : null;
  const parts = msg && typeof msg === "object" && msg.content != null
    ? msg.content
    : (data && typeof data === "object" ? data.content : null);
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p && typeof p === "object" && p.type === "text")
    .map((p) => String(p.text || ""))
    .join("\n");
}

export function cardHash(card) {
  return crypto.createHash("sha1").update(JSON.stringify(card)).digest("hex");
}

function shortHash(text) {
  return crypto.createHash("sha1").update(String(text || "")).digest("hex").slice(0, 12);
}

/**
 * 构建 Card 2.0。`phase` 只影响 header/end line；body 第一行永远是计数。
 */
export function buildProgressCard({ phase = "running", counts = emptyCounts(), marker = null, elapsedMs = 0 } = {}) {
  const final = ["done", "failed", "cancelled"].includes(phase);
  const title = phase === "done"
    ? `处理完成 · 用时 ${formatDuration(elapsedMs)}`
    : phase === "failed"
      ? `处理中断 · 用时 ${formatDuration(elapsedMs)}`
      : phase === "cancelled"
        ? `已暂停 · 用时 ${formatDuration(elapsedMs)}`
        : `处理中 · 已用时 ${formatDuration(elapsedMs)}`;
  const step = marker?.step ? ` · 第 ${marker.step.n}/${marker.step.total} 步` : "";
  const template = phase === "done" ? "green"
    : phase === "failed" ? "orange"
      : phase === "cancelled" ? "grey" : "blue";
  const lines = [countsLine(counts)];
  if (!final) {
    if (marker?.now) lines.push(`现在：${marker.now}`);
    if (marker?.next) lines.push(`接着：${marker.next}`);
  } else {
    lines.push(phase === "done" ? "已经处理完，稍后回你。"
      : phase === "failed" ? "这边有点状况，稍后回你。"
        : "这边先暂停一下，稍后回你。");
  }
  const card = {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: { tag: "plain_text", content: `${title}${step}` },
      template,
    },
    body: {
      elements: [
        { tag: "markdown", content: lines.join("\n\n") },
        { tag: "hr" },
        { tag: "markdown", content: "只同步进度，不展示内容", text_size: "notation" },
      ],
    },
  };
  if (Buffer.byteLength(JSON.stringify(card), "utf8") > 29_000) {
    card.body.elements = [
      { tag: "markdown", content: `${countsLine(counts)}\n\n${lines[lines.length - 1]}` },
      { tag: "markdown", content: "只同步进度，不展示内容", text_size: "notation" },
    ];
  }
  return card;
}

export class ProgressTracker {
  constructor({ platform, chatId, turnId, state, im, logger = console, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) }) {
    this.platform = platform;
    this.chatId = chatId;
    this.turnId = turnId;
    this.state = state;
    this.im = im;
    this.logger = logger;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.startedAt = nowMs(now);
    this.cardCreatedAt = 0;
    this.endedAt = 0;
    this.turn = null;
    this.counts = emptyCounts();
    this.marker = null;
    this.msgId = "";
    this.lastHash = "";
    this.lastPersistAt = 0;
    this.failures = 0;
    this.dead = false;
    this.stopped = false;
    this.finished = false;
    this.finalPhase = "";
    this.patching = false;
    this.dirty = false;
    this.finalPending = false;
    this.createTimer = null;
    this.patchTimer = null;
  }

  get key() { return chatKey(this.platform, this.chatId); }

  currentChat() { return this.state.getChat(this.platform, this.chatId) || null; }

  progress() {
    const p = this.currentChat()?.progress;
    return p && typeof p === "object" ? p : {};
  }

  saveProgress(patch, { force = false } = {}) {
    const chat = this.currentChat();
    if (!chat) return;
    const cur = chat.progress && typeof chat.progress === "object" ? chat.progress : {};
    chat.progress = { ...cur, ...patch };
    if (!Array.isArray(chat.progress.ids)) chat.progress.ids = [];
    chat.progress.ids = [...new Set(chat.progress.ids.map(String).filter(Boolean))].slice(-5);
    chat.progress.counts = normalizeCounts(chat.progress.counts || this.counts);
    const t = nowMs(this.now);
    if (force || t - this.lastPersistAt > 15_000) {
      this.lastPersistAt = t;
      try { this.state.save(); } catch { /* 保存失败不阻塞 turn */ }
    }
  }

  start() {
    if (this.dead || this.stopped || this.finished) return this;
    this.createTimer = this.setTimer(() => this.maybeCreate(), CREATE_DELAY_MS);
    this.createTimer?.unref?.();
    return this;
  }

  stop() {
    this.stopped = true;
    if (this.createTimer) this.clearTimer(this.createTimer);
    if (this.patchTimer) this.clearTimer(this.patchTimer);
    this.createTimer = null;
    this.patchTimer = null;
  }

  note(event) {
    if (this.dead || this.stopped || this.finished) return;
    const type = String(event?.type || "");
    const data = event?.data && typeof event.data === "object" ? event.data : {};
    const turn = Number.isFinite(Number(data.turn)) ? Number(data.turn) : null;
    if (turn !== null && this.turn !== null && turn !== this.turn) return;
    if (type === "turn/start") {
      this.turn = turn;
      this.counts = emptyCounts();
      this.marker = null;
      return;
    }
    if (type === "tool/call") {
      this.turn = turn ?? this.turn;
      addAction(this.counts, data.name);
      if (this.msgId) this.schedulePatch(EVENT_PATCH_DELAY_MS);
      return;
    }
    if (type === "assistant/message") {
      this.turn = turn ?? this.turn;
      const marker = parseProgressLine(extractText(data));
      if (marker) {
        this.marker = marker;
        if (this.msgId) this.schedulePatch(EVENT_PATCH_DELAY_MS);
      }
      return;
    }
    if (type === "turn/end") {
      this.endReason = String(data?.reason?.kind || "completed");
    }
  }

  maybeCreate() {
    this.createTimer = null;
    if (this.dead || this.stopped || this.finished) return;
    if (this.msgId) { this.patch(); return; }
    const p = this.progress();
    if (p.msg_id && p.state === "running" &&
        nowMs(this.now) - (Number(p.updated_at) || 0) * 1000 < REUSE_WINDOW_MS) {
      this.msgId = String(p.msg_id);
      this.lastHash = "";
      this.cardCreatedAt = nowMs(this.now);
      this.saveProgress({ turn_id: this.turnId, state: "running", updated_at: nowMs(this.now) / 1000 }, { force: true });
      this.patch();
      return;
    }
    const card = this.card();
    const hash = cardHash(card);
    const key = `progress:${this.platform}:${shortHash(this.chatId)}:${shortHash(this.turnId)}`;
    Promise.resolve()
      .then(() => this.im.sendCard(this.platform, this.chatId, card, { idempotencyKey: key }))
      .then((r) => {
        if (!r || r.ok !== true || !r.message_id) {
          this.failures += 1;
          this.saveProgress({ last_error: String(r?.error || "send_failed").slice(0, 160) }, { force: true });
          this.logger.warn?.(`[im-standin] progress send ${this.key}: ${r?.error || "no message_id"}`);
          return;
        }
        this.msgId = String(r.message_id);
        this.lastHash = hash;
        this.cardCreatedAt = nowMs(this.now);
        const prev = this.progress();
        const ids = [...new Set([...(prev.ids || []).map(String), this.msgId])].slice(-5);
        this.saveProgress({
          msg_id: this.msgId, turn_id: this.turnId, state: "running",
          created_at: Number(prev.created_at) || nowMs(this.now) / 1000,
          updated_at: nowMs(this.now) / 1000, last_error: "", ids,
          counts: this.counts,
        }, { force: true });
        this.scheduleHeartbeat();
      })
      .catch((e) => {
        this.saveProgress({ last_error: String(e?.message || e).slice(0, 160) }, { force: true });
        this.logger.warn?.(`[im-standin] progress send ${this.key}: ${e?.message || e}`);
      });
  }

  card() {
    return buildProgressCard({
      phase: this.finished ? this.finalPhase : "running",
      counts: this.counts,
      marker: this.marker,
      elapsedMs: Math.max(0, (this.endedAt || nowMs(this.now)) - this.startedAt),
    });
  }

  schedulePatch(delay) {
    if (this.dead || this.stopped || this.finished || !this.msgId) return;
    if (this.patchTimer) this.clearTimer(this.patchTimer);
    this.patchTimer = this.setTimer(() => { this.patchTimer = null; this.patch(); }, Math.max(0, Number(delay) || 0));
    this.patchTimer?.unref?.();
  }

  scheduleHeartbeat() {
    if (this.finished || this.dead || this.stopped) return;
    const age = nowMs(this.now) - (this.cardCreatedAt || nowMs(this.now));
    const delay = age < 120_000 ? 10_000 : age < 600_000 ? 30_000 : 60_000;
    this.schedulePatch(delay);
  }

  patch(final = false) {
    if (this.dead || this.stopped || !this.msgId) return;
    if (this.patching) {
      this.dirty = true;
      if (final) this.finalPending = true;
      return;
    }
    const card = this.card();
    const hash = cardHash(card);
    if (!final && hash === this.lastHash) {
      if (!this.finished) this.scheduleHeartbeat();
      return;
    }
    this.patching = true;
    this.dirty = false;
    Promise.resolve()
      .then(() => this.im.patchCard(this.platform, this.msgId, card))
      .then((r) => {
        if (!r || r.ok !== true) { this.onPatchError(r?.error || "patch_failed"); return; }
        this.failures = 0;
        this.lastHash = hash;
        this.saveProgress({
          updated_at: nowMs(this.now) / 1000, last_error: "", counts: this.counts,
          ...(this.finished ? { state: this.finalPhase === "done" ? "done" : this.finalPhase === "cancelled" ? "cancelled" : "failed" } : {}),
        }, { force: this.finished });
      })
      .catch((e) => this.onPatchError(e?.message || String(e)))
      .finally(() => {
        this.patching = false;
        if (this.finalPending && !this.dead) { this.finalPending = false; this.patch(true); return; }
        if (this.dirty && !this.finished && !this.dead) { this.dirty = false; this.patch(); return; }
        if (!this.finished && !this.dead) this.scheduleHeartbeat();
      });
  }

  onPatchError(error) {
    const text = String(error || "patch_failed");
    this.failures += 1;
    this.saveProgress({ last_error: text.slice(0, 160) }, { force: true });
    if (/(230011|230110|recalled|deleted|NOT a card|230001)/i.test(text)) {
      this.dead = true;
      this.logger.warn?.(`[im-standin] progress gone ${this.key}: ${text.slice(0, 120)}`);
      return;
    }
    if (this.failures >= 3) {
      this.dead = true;
      this.logger.warn?.(`[im-standin] progress stop ${this.key}: ${text.slice(0, 120)}`);
      return;
    }
    this.logger.warn?.(`[im-standin] progress patch ${this.key}: ${text.slice(0, 120)}`);
  }

  finish(result = {}) {
    if (this.finished || this.stopped) return;
    this.finished = true;
    this.endedAt = nowMs(this.now);
    if (result?.ok === true) this.finalPhase = "done";
    else if (String(result?.reason || "") === "cancelled") this.finalPhase = "cancelled";
    else this.finalPhase = "failed";
    if (this.createTimer) this.clearTimer(this.createTimer);
    if (this.patchTimer) this.clearTimer(this.patchTimer);
    this.createTimer = null;
    this.patchTimer = null;
    this.saveProgress({
      turn_id: this.turnId,
      state: this.finalPhase === "done" ? "done" : this.finalPhase === "cancelled" ? "cancelled" : "failed",
      updated_at: nowMs(this.now) / 1000, counts: this.counts,
    }, { force: true });
    if (this.msgId) this.patch(true);
  }

  cancel() { this.finish({ ok: false, reason: "cancelled" }); }
}

export class ProgressCards {
  constructor({ state, im, logger = console, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) }) {
    this.state = state;
    this.im = im;
    this.logger = logger;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.active = new Map();
    this.sweeping = false;
  }

  enabled(chat) {
    if (!chat || chat.platform !== "feishu" || chat.kind !== "p2p") return false;
    if (chat.watching !== true || chat.blocked === true) return false;
    const global = this.state.data.config?.dsh?.progress_card === true;
    const on = chat.progress_card === true ? true : chat.progress_card === false ? false : global;
    return on && typeof this.im?.sendCard === "function" && typeof this.im?.patchCard === "function";
  }

  begin({ chat, turnId }) {
    const current = this.state.getChat(chat.platform, chat.chat_id) || chat;
    if (!this.enabled(current) || !turnId) return null;
    const key = chatKey(current.platform, current.chat_id);
    const old = this.active.get(key);
    if (old) old.stop();
    const tracker = new ProgressTracker({
      platform: current.platform, chatId: current.chat_id, turnId: String(turnId),
      state: this.state, im: this.im, logger: this.logger,
      now: this.now, setTimer: this.setTimer, clearTimer: this.clearTimer,
    });
    this.active.set(key, tracker);
    tracker.start();
    return tracker;
  }

  note(platform, chatId, event) {
    this.active.get(chatKey(platform, chatId))?.note(event);
  }

  finish(platform, chatId, turnId, result) {
    const key = chatKey(platform, chatId);
    const tracker = this.active.get(key);
    if (!tracker || tracker.turnId !== String(turnId)) return;
    tracker.finish(result);
    this.active.delete(key);
  }

  cancel(platform, chatId, turnId) { this.finish(platform, chatId, turnId, { ok: false, reason: "cancelled" }); }

  stopAll() {
    for (const tracker of this.active.values()) tracker.stop();
    this.active.clear();
  }

  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      if (typeof this.im?.patchCard !== "function") return;
      for (const chat of Object.values(this.state.data.chats || {})) {
        if (!chat || chat.platform !== "feishu" || chat.kind !== "p2p") continue;
        const p = chat.progress && typeof chat.progress === "object" ? chat.progress : {};
        if (p.state !== "running" || !p.msg_id) continue;
        const elapsed = Math.max(0, nowMs(this.now) - (Number(p.updated_at) || 0) * 1000);
        const card = buildProgressCard({ phase: "cancelled", counts: p.counts, marker: null, elapsedMs: elapsed });
        let ok = false;
        try {
          const r = await this.im.patchCard(chat.platform, p.msg_id, card);
          ok = r?.ok === true;
        } catch { /* logged below */ }
        if (!ok) this.logger.warn?.(`[im-standin] progress sweep ${chat.platform}/${chat.chat_id}: failed`);
        chat.progress = {
          ...p, state: "cancelled", updated_at: nowMs(this.now) / 1000,
          last_error: ok ? "" : String(p.last_error || "restart_sweep_failed").slice(0, 160),
        };
        try { this.state.save(); } catch { /* noop */ }
      }
    } finally {
      this.sweeping = false;
    }
  }
}
