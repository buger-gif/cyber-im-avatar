/**
 * progress.js — 飞书私聊 / 群聊进度卡（spec 0061，承接 0052）。
 *
 * 设计原则：卡片首先要能证明“真的在干活”。最可靠的证据是 agent 实际发生的
 * tool call 计数，而不是“正在处理”这种状态词。计数只按工具名归到四类：
 * 查资料 / 改文件 / 执行操作 / 并行处理；不读参数、结果、命令、路径。
 *
 * `[进度]` 标记是可选增强：有就补任务级“现在/接着/第几步”，没有也仍有计数。
 * 卡片由本人身份发 Card 2.0（im.sendCard 走 --as user），本模块不碰 bot。
 * 目标发信后撤回卡片（im.recallCard）；撤回失败才 patch「已回复」保底。
 */
import crypto from "node:crypto";

import { chatKey } from "./state.js";

export const CREATE_DELAY_MS = 2 * 60 * 1000;
export const EVENT_PATCH_DELAY_MS = 1_500;
export const MAX_LABEL = 60;
const RECENT_TOLERANCE_MS = 1_000;
const CARD_SUPPRESS_MS = 10_000;

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
  const final = ["replied", "done", "failed", "cancelled"].includes(phase);
  const title = phase === "replied"
    ? `已回复 · 用时 ${formatDuration(elapsedMs)}`
    : phase === "done"
      ? `处理完成 · 用时 ${formatDuration(elapsedMs)}`
      : phase === "failed"
        ? `处理中断 · 用时 ${formatDuration(elapsedMs)}`
        : phase === "cancelled"
          ? `已暂停 · 用时 ${formatDuration(elapsedMs)}`
          : `处理中 · 已用时 ${formatDuration(elapsedMs)}`;
  const step = marker?.step ? ` · 第 ${marker.step.n}/${marker.step.total} 步` : "";
  const template = phase === "replied" || phase === "done" ? "green"
    : phase === "failed" ? "orange"
      : phase === "cancelled" ? "grey" : "blue";
  const lines = [countsLine(counts)];
  if (!final) {
    if (marker?.now) lines.push(`现在：${marker.now}`);
    if (marker?.next) lines.push(`接着：${marker.next}`);
  } else {
    lines.push(phase === "replied" ? "回复已经发出。"
      : phase === "done" ? "已经处理完，稍后回你。"
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


const SHELL_TOOL_RE = /(^|[-_])(bash|shell|terminal|pwsh|powershell|exec|zsh|sh)$/i;
const SHELL_WRAPPERS = new Set(["env", "command", "exec", "time", "sudo", "npx"]);

/** 只认 shell 类工具；别的工具参数一律不碰。 */
export function isShellTool(name) {
  const s = String(name || "").trim().toLowerCase();
  return !!s && SHELL_TOOL_RE.test(s);
}

/** 从 shell 工具的 arguments 里取 command；只取命令字段，不取结果。 */
export function shellCommandFromArguments(argumentsValue) {
  let args = argumentsValue;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return ""; }
  }
  if (!args || typeof args !== "object") return "";
  const command = args.command ?? args.cmd ?? args.script;
  return typeof command === "string" ? command : "";
}

function shellBase(token) {
  return String(token || "").split(/[\\/]/).pop().toLowerCase();
}

/**
 * 把一条 shell 命令拆成简单命令；只处理引号与常见分隔符，不执行、不展开。
 * `$()` / 反引号 / heredoc 里的内容可能识别不了，交给 recent 兜底。
 */
export function splitShellCommands(command) {
  const text = String(command || "");
  const commands = [];
  let tokens = [];
  let current = "";
  let quote = "";
  let escaped = false;
  const pushToken = () => { if (current) { tokens.push(current); current = ""; } };
  const pushCommand = () => {
    pushToken();
    if (tokens.length) commands.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { current += ch; escaped = false; continue; }
    if (quote) {
      if (ch === "\\" && quote === '"') { escaped = true; continue; }
      if (ch === quote) { quote = ""; continue; }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === "#") {
      // 行内注释：跳到行尾，保留已解析的当前命令。
      while (i < text.length && text[i] !== "\n") i++;
      pushCommand();
      continue;
    }
    if (ch === "\n" || ch === ";" || ch === "|" || ch === "&") {
      pushCommand();
      if ((ch === "|" || ch === "&") && text[i + 1] === ch) i++;
      continue;
    }
    if (/\s/.test(ch)) { pushToken(); continue; }
    current += ch;
  }
  pushCommand();
  return commands;
}

function flagValue(tokens, name) {
  const prefix = name + "=";
  for (let i = 0; i < tokens.length; i++) {
    const t = String(tokens[i] || "");
    if (t === name) return String(tokens[i + 1] || "");
    if (t.startsWith(prefix)) return t.slice(prefix.length);
  }
  return "";
}

function hasFlag(tokens, name) {
  return tokens.some((t) => String(t || "") === name || String(t || "").startsWith(name + "="));
}

/**
 * 判断 shell 命令里是否出现「向当前会话发消息」的 lark-cli 调用。
 * 只读命令文本；目标匹配基于 chat_id / 最近 sender 的 open_id / 最近 msg_id。
 * 不返回命令内容，不落日志。
 */
export function isOutboundCommand(command, chat) {
  if (!chat) return false;
  const kind = chat.kind === "group" ? "group" : "p2p";
  const recent = Array.isArray(chat.recent) ? chat.recent : [];
  const messageIds = new Set(recent.map((m) => String(m?.msg_id || "")).filter(Boolean));
  const people = new Set([String(chat.chat_id || "")].filter(Boolean));
  if (kind === "p2p") {
    for (const m of recent) {
      if (!m || m.kind === "out" || m.kind === "cmd") continue;
      const sid = String(m.sender_id || "");
      if (sid) people.add(sid);
    }
  }
  for (const tokens of splitShellCommands(command)) {
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }
      if (!SHELL_WRAPPERS.has(shellBase(t))) break;
      i++;
      while (i < tokens.length && (tokens[i].startsWith("-") ||
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))) i++;
    }
    if (shellBase(tokens[i]) !== "lark-cli") continue;
    const rest = tokens.slice(i + 1);
    const im = rest.indexOf("im");
    if (im < 0) continue;
    const send = rest.findIndex((t) => t === "+messages-send" || t === "+messages-reply");
    if (send < im) continue;
    if (hasFlag(rest, "--dry-run")) continue;
    const reply = rest[send] === "+messages-reply";
    const chatId = flagValue(rest, "--chat-id");
    const userId = flagValue(rest, "--user-id");
    const targetChat = !!chatId && chatId === String(chat.chat_id || "");
    const targetUser = kind === "p2p" && !!userId && people.has(userId);
    if (reply) {
      const msgId = flagValue(rest, "--message-id");
      if (msgId && messageIds.has(msgId)) return true;
      continue;
    }
    if (targetChat || targetUser) return true;
  }
  return false;
}

export class ProgressTracker {
  constructor({ platform, chatId, turnId, state, im, logger = console, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t), startedAt = 0, snapshot = null }) {
    this.platform = platform;
    this.chatId = chatId;
    this.turnId = String(turnId || "");
    this.state = state;
    this.im = im;
    this.logger = logger;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.startedAt = Number(snapshot?.startedAt) || Number(startedAt) || nowMs(now);
    this.cardCreatedAt = Number(snapshot?.cardCreatedAt) || 0;
    this.endedAt = 0;
    this.turn = null;
    this.armed = false;
    this.counts = normalizeCounts(snapshot?.counts || emptyCounts());
    this.marker = null;
    this.msgId = String(snapshot?.msgId || "");
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
    this.creating = false;
    this.handoff = false;
    this.recalledId = "";
    this.recallInFlight = false;
    this.recallPending = false;
    this.suppressCardUntil = 0;
    // 等待期开始前已经存在的本人消息不算「本轮已发信」；按 ID 记住，避免下一条指令
    // 被上一条回复的时钟误差 / 拉取延迟误收口。
    this.baselineOutIds = new Set((this.currentChat()?.recent || [])
      .filter((m) => m?.kind === "out" && m.msg_id)
      .map((m) => String(m.msg_id)));
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

  /** 兼容旧调用；真正起定时器的是 arm()。 */
  start() { return this; }

  /** handoff 后绑定到新 turn；保留等待期起点、计数与同一张卡。 */
  resumeForTurn(turnId) {
    if (this.finished || this.dead) return false;
    this.turnId = String(turnId || "");
    this.stopped = false;
    this.handoff = false;
    this.armed = false;
    this.turn = null;
    this.marker = null;
    this.dirty = false;
    this.finalPending = false;
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.createTimer) this.clearTimer(this.createTimer);
    if (this.patchTimer) this.clearTimer(this.patchTimer);
    this.createTimer = null;
    this.patchTimer = null;
  }

  scheduleCreate(delay) {
    if (this.dead || this.stopped || this.finished || this.msgId) return;
    if (this.createTimer) this.clearTimer(this.createTimer);
    this.createTimer = this.setTimer(() => { this.createTimer = null; this.maybeCreate(); },
      Math.max(0, Number(delay) || 0));
    this.createTimer?.unref?.();
  }

  /** 绑定当前 DSH turn；arm 之前的事件一律不收。 */
  arm(turn) {
    if (this.dead || this.stopped || this.finished) return this;
    this.armed = true;
    this.turn = Number.isFinite(Number(turn)) ? Number(turn) : null;
    const out = this.recentOutbound();
    if (out) { this.sent(out); return this; }
    if (this.msgId) {
      this.lastHash = "";
      this.patch();
      this.scheduleHeartbeat();
      return this;
    }
    const age = nowMs(this.now) - this.startedAt;
    if (age >= CREATE_DELAY_MS) this.maybeCreate();
    else this.scheduleCreate(CREATE_DELAY_MS - age);
    return this;
  }

  note(event) {
    if (!this.armed || this.dead || this.stopped || this.finished) return;
    const out = this.recentOutbound();
    if (out) { this.sent(out); return; }
    const type = String(event?.type || "");
    const data = event?.data && typeof event.data === "object" ? event.data : {};
    const turn = Number.isFinite(Number(data.turn)) ? Number(data.turn) : null;
    if (turn !== null && this.turn !== null && turn !== this.turn) return;
    if (type === "turn/start") {
      if (this.turn === null) this.turn = turn;
      return;
    }
    if (type === "tool/call") {
      const command = isShellTool(data.name) ? shellCommandFromArguments(data.arguments) : "";
      if (command && isOutboundCommand(command, this.currentChat())) {
        this.sent({});
        return;
      }
      addAction(this.counts, data.name);
      if (this.msgId) this.schedulePatch(EVENT_PATCH_DELAY_MS);
      return;
    }
    if (type === "assistant/message") {
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

  /**
   * 已发信的最早证据：等待期开始后的本人 out 消息（排除进度卡自身与 cmd）。
   * 只读 recent 指针，不额外拉取，不读正文。
   */
  recentOutbound() {
    const chat = this.currentChat();
    if (!chat) return null;
    const p = this.progress();
    const ids = new Set([...(Array.isArray(p.ids) ? p.ids : []), this.msgId].map(String).filter(Boolean));
    const floor = this.startedAt - RECENT_TOLERANCE_MS;
    let best = null;
    let bestAt = Infinity;
    for (const m of Array.isArray(chat.recent) ? chat.recent : []) {
      if (!m || m.kind !== "out") continue;
      const id = String(m.msg_id || "");
      if (!id || ids.has(id) || this.baselineOutIds.has(id)) continue;
      const ts = Number(m.ts_epoch) || 0;
      if (!ts) continue;
      const at = ts * 1000;
      if (at < floor) continue;
      // 自己发的进度卡还没写进 ids 时，别把发卡当「已发信」。
      if ((this.creating || at <= this.suppressCardUntil) && String(m.msg_type || "") === "interactive") continue;
      if (at < bestAt) { best = { msgId: id, tsEpoch: ts }; bestAt = at; }
    }
    return best;
  }

  maybeCreate() {
    this.createTimer = null;
    if (this.dead || this.stopped || this.finished || !this.armed) return;
    if (this.msgId) { this.patch(); return; }
    const out = this.recentOutbound();
    if (out) { this.sent(out); return; }
    const age = nowMs(this.now) - this.startedAt;
    if (age < CREATE_DELAY_MS) { this.scheduleCreate(CREATE_DELAY_MS - age); return; }
    this.createCard();
  }

  createCard() {
    if (this.creating || this.dead || this.stopped || this.finished || this.msgId) return;
    this.creating = true;
    const card = this.card();
    const hash = cardHash(card);
    const key = `progress:${this.platform}:${shortHash(this.chatId)}:${shortHash(this.turnId)}`;
    const prev = this.progress();
    const oldId = String(prev.msg_id || "");
    // 只留最新一张：新等待期建卡前，旧卡尽力撤回。
    if (oldId && oldId !== this.msgId && typeof this.im.recallCard === "function") {
      Promise.resolve().then(() => this.im.recallCard(this.platform, oldId))
        .then((r) => { if (r?.ok !== true) this.logger.warn?.(`[im-standin] progress old recall ${this.key}`); })
        .catch(() => { /* 旧卡撤回失败不阻塞新卡 */ });
    }
    Promise.resolve()
      .then(() => this.im.sendCard(this.platform, this.chatId, card, { idempotencyKey: key }))
      .then((r) => {
        this.creating = false;
        if (!r || r.ok !== true || !r.message_id) {
          this.failures += 1;
          this.saveProgress({ last_error: String(r?.error || "send_failed").slice(0, 160) }, { force: true });
          this.logger.warn?.(`[im-standin] progress send ${this.key}: ${r?.error || "no message_id"}`);
          return;
        }
        this.msgId = String(r.message_id);
        this.lastHash = hash;
        this.cardCreatedAt = nowMs(this.now);
        this.suppressCardUntil = nowMs(this.now) + CARD_SUPPRESS_MS;
        const ids = [...new Set([...(prev.ids || []).map(String), String(prev.msg_id || ""), this.msgId])]
          .filter(Boolean).slice(-5);
        const state = this.finished
          ? (this.finalPhase === "replied" ? "replied"
            : this.finalPhase === "cancelled" ? "cancelled"
              : this.finalPhase === "done" ? "done" : "failed")
          : "running";
        this.saveProgress({
          msg_id: this.msgId, turn_id: this.turnId, state,
          created_at: nowMs(this.now) / 1000,
          updated_at: nowMs(this.now) / 1000, last_error: "", ids,
          counts: this.counts,
        }, { force: true });
        if (this.finished) {
          if (this.finalPhase === "replied") this.finalizeReplied();
          else this.patch(true);
          return;
        }
        // handoff 时旧 tracker 已 stop：把 msgId 留在 tracker 里，等新 turn 接管。
        if (this.stopped) return;
        this.scheduleHeartbeat();
      })
      .catch((e) => {
        this.creating = false;
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
    if (!this.finished) {
      const out = this.recentOutbound();
      if (out) { this.sent(out); return; }
    }
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
        const state = this.finished
          ? (this.finalPhase === "replied" ? "replied"
            : this.finalPhase === "cancelled" ? "cancelled"
              : this.finalPhase === "done" ? "done" : "failed")
          : undefined;
        this.saveProgress({
          updated_at: nowMs(this.now) / 1000, last_error: "", counts: this.counts,
          ...(state ? { state } : {}),
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

  /** 发信收口：优先撤回；撤回失败才 patch「已回复」保底。 */
  sent(info = {}) {
    if (this.dead || this.stopped || this.finished) return;
    this.finished = true;
    this.finalPhase = "replied";
    const at = Number(info?.tsEpoch) ? Number(info.tsEpoch) * 1000 : nowMs(this.now);
    this.endedAt = Math.max(this.startedAt, at);
    if (this.createTimer) this.clearTimer(this.createTimer);
    if (this.patchTimer) this.clearTimer(this.patchTimer);
    this.createTimer = null;
    this.patchTimer = null;
    // 当前等待期没有卡，但上一张还留着：一并撤回，保证会话里只留最新状态。
    const prev = this.progress();
    if (!this.msgId) {
      const prevId = String(prev.msg_id || "");
      if (prevId) this.msgId = prevId;
    }
    if (!this.msgId) return;
    const ids = [...new Set([...(prev.ids || []).map(String), this.msgId].filter(Boolean))].slice(-5);
    this.saveProgress({
      turn_id: this.turnId, state: "replied", ids,
      updated_at: nowMs(this.now) / 1000, counts: this.counts,
    }, { force: true });
    this.finalizeReplied();
  }

  finalizeReplied() {
    if (!this.msgId || this.recalledId === this.msgId) return;
    if (this.recallInFlight) { this.recallPending = true; return; }
    if (typeof this.im.recallCard !== "function") { this.patch(true); return; }
    this.recallInFlight = true;
    Promise.resolve()
      .then(() => this.im.recallCard(this.platform, this.msgId))
      .then((r) => {
        if (r?.ok === true || /(230011|230110|recalled|deleted|not a card|not found)/i.test(String(r?.error || ""))) {
          this.recalledId = this.msgId;
          this.saveProgress({
            state: "replied", updated_at: nowMs(this.now) / 1000,
            last_error: "", counts: this.counts,
          }, { force: true });
          this.logger.info?.(`[im-standin] progress recalled ${this.key}`);
          return;
        }
        this.logger.warn?.(`[im-standin] progress recall ${this.key}: ${r?.error || "failed"}`);
        this.recalledId = this.msgId;
        this.patch(true);
      })
      .catch((e) => {
        this.logger.warn?.(`[im-standin] progress recall ${this.key}: ${e?.message || e}`);
        this.recalledId = this.msgId;
        this.patch(true);
      })
      .finally(() => {
        this.recallInFlight = false;
        if (this.recallPending) { this.recallPending = false; this.finalizeReplied(); }
      });
  }

  finish(result = {}) {
    if (this.finished || this.stopped) return;
    const out = this.recentOutbound();
    if (out) { this.sent(out); return; }
    this.finished = true;
    this.endedAt = nowMs(this.now);
    if (result?.ok === true) this.finalPhase = "done";
    else if (String(result?.reason || "") === "cancelled") this.finalPhase = "cancelled";
    else this.finalPhase = "failed";
    if (this.createTimer) this.clearTimer(this.createTimer);
    if (this.patchTimer) this.clearTimer(this.patchTimer);
    this.createTimer = null;
    this.patchTimer = null;
    if (!this.msgId) return; // 建卡在飞：落地后按 finished 补终态
    this.saveProgress({
      turn_id: this.turnId,
      state: this.finalPhase === "done" ? "done" : this.finalPhase === "cancelled" ? "cancelled" : "failed",
      updated_at: nowMs(this.now) / 1000, counts: this.counts,
    }, { force: true });
    this.patch(true);
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
    this.handoffs = new Map();
    this.sweeping = false;
  }

  enabled(chat) {
    if (!chat || chat.platform !== "feishu") return false;
    if (chat.kind !== "p2p" && chat.kind !== "group") return false;
    if (chat.watching !== true || chat.blocked === true) return false;
    const cfg = this.state.data.config?.dsh || {};
    const global = chat.kind === "group" ? cfg.progress_card_group === true : cfg.progress_card === true;
    const on = chat.progress_card === true ? true : chat.progress_card === false ? false : global;
    return on && typeof this.im?.sendCard === "function" && typeof this.im?.patchCard === "function";
  }

  begin({ chat, turnId }) {
    const current = this.state.getChat(chat.platform, chat.chat_id) || chat;
    if (!this.enabled(current) || !turnId) {
      this.abortHandoff(current.platform, current.chat_id, { ok: false, reason: "cancelled" });
      return null;
    }
    const key = chatKey(current.platform, current.chat_id);
    const old = this.active.get(key);
    if (old) {
      if (!old.finished) old.finish({ ok: false, reason: "cancelled" });
      this.active.delete(key);
    }
    let tracker = this.handoffs.get(key) || null;
    if (tracker) {
      this.handoffs.delete(key);
      if (!tracker.resumeForTurn(turnId)) {
        tracker.finish({ ok: false, reason: "cancelled" });
        tracker = null;
      }
    }
    if (!tracker) {
      tracker = new ProgressTracker({
        platform: current.platform, chatId: current.chat_id, turnId: String(turnId),
        state: this.state, im: this.im, logger: this.logger,
        now: this.now, setTimer: this.setTimer, clearTimer: this.clearTimer,
      });
    }
    this.active.set(key, tracker);
    return tracker;
  }

  /** 新指令打断未发信的运行中轮：保留同一张卡和等待期，不 patch 暂停。 */
  handoff(platform, chatId, turnId) {
    const key = chatKey(platform, chatId);
    const tracker = this.active.get(key);
    if (!tracker || tracker.turnId !== String(turnId) || tracker.finished) return false;
    const out = tracker.recentOutbound();
    if (out) {
      tracker.sent(out);
      this.active.delete(key);
      return "replied";
    }
    tracker.handoff = true;
    tracker.stop();
    this.active.delete(key);
    this.handoffs.set(key, tracker);
    return "handoff";
  }

  abortHandoff(platform, chatId, result = { ok: false, reason: "cancelled" }) {
    const key = chatKey(platform, chatId);
    const tracker = this.handoffs.get(key);
    if (!tracker) return false;
    this.handoffs.delete(key);
    tracker.stopped = false;
    tracker.handoff = false;
    tracker.finish(result);
    return true;
  }

  /** 绑定当前 DSH turn；未拿到 turn 时用 null，只靠 arm 之后的 listener 兜底。 */
  arm(platform, chatId, turnId, turn) {
    const key = chatKey(platform, chatId);
    const tracker = this.active.get(key);
    if (!tracker || tracker.turnId !== String(turnId)) return;
    tracker.arm(turn);
    if (tracker.finished) this.active.delete(key);
  }

  note(platform, chatId, event, turnId = "") {
    const key = chatKey(platform, chatId);
    const tracker = this.active.get(key);
    if (!tracker) return;
    if (turnId && tracker.turnId !== String(turnId)) return;
    tracker.note(event);
    if (tracker.finished) this.active.delete(key);
  }

  finish(platform, chatId, turnId, result) {
    const key = chatKey(platform, chatId);
    const tracker = this.active.get(key);
    if (!tracker || tracker.turnId !== String(turnId)) return;
    tracker.finish(result);
    if (tracker.finished || tracker.stopped) this.active.delete(key);
  }

  cancel(platform, chatId, turnId) { this.finish(platform, chatId, turnId, { ok: false, reason: "cancelled" }); }

  stopAll() {
    for (const tracker of this.active.values()) tracker.stop();
    for (const tracker of this.handoffs.values()) tracker.stop();
    this.active.clear();
    this.handoffs.clear();
  }

  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      if (typeof this.im?.patchCard !== "function") return;
      for (const chat of Object.values(this.state.data.chats || {})) {
        if (!chat || chat.platform !== "feishu") continue;
        if (chat.kind !== "p2p" && chat.kind !== "group") continue;
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
