/**
 * poller.js — 值守的「耳朵」。
 *
 * 定时：每 10 分钟只拉值守中的私聊 + 明确勾了 timer=1 的群；屏蔽的一律不拉。
 * 按需：点开会话拉一次。
 * 手动：立刻拉一轮，冷却 20 秒。
 *
 * 拉到的消息只保留最近 10 条到 state.json；更早的正文/历史由 agent 在线查。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMention, PLATFORM_META } from "./im.js";
import { chatKey, RECENT_LIMIT } from "./state.js";

function nowSec() {
  return Date.now() / 1000;
}

function skillPath() {
  const agents = process.env.DSH_AGENTS_HOME || path.join(os.homedir(), ".agents");
  const installed = path.join(agents, "skills", "cyber-im-avatar", "SKILL.md");
  if (fs.existsSync(installed)) return installed;
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "SKILL.md");
  return fs.existsSync(repo) ? repo : installed;
}

export class Poller {
  constructor({ state, im, logger = console }) {
    this.state = state;
    this.im = im;
    this.logger = logger;
    this.turns = null;
    this.started = false;
    this.stopped = false;
    this.timer = null;
    this.startedAt = nowSec();
    this.nextCycleAt = 0;
    this.identity = {};
    this.errors = [];
    this.cycleLock = false;
    this.lastErrorAt = 0;
    const runtime = this.state.data.runtime || {};
    this.cycles = Number(runtime.cycles) || 0;
    this.lastCycleAt = Number(runtime.last_cycle_at) || 0;
    this.lastCycleMs = Number(runtime.last_cycle_ms) || 0;
    this.lastResult = runtime.last_result || {};
  }

  get cfg() {
    return this.state.data.config;
  }

  get paused() {
    return !!this.state.data.paused;
  }

  get intervalSec() {
    return Math.max(10, Number(this.cfg?.poll?.interval_min) || 10) * 60;
  }

  get cooldownSec() {
    return Math.max(0, Number(this.cfg?.poll?.cooldown_sec) || 0);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.startedAt = nowSec();
    this.nextCycleAt = nowSec() + 3;
    this.schedule(3);
  }

  schedule(sec) {
    if (this.timer) clearTimeout(this.timer);
    const ms = Math.max(1, Number(sec) || 1) * 1000;
    this.timer = setTimeout(() => { this.tick().catch((e) => this.logError(null, null, e)); }, ms);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    this.stopped = true;
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  reload() {
    this.nextCycleAt = nowSec() + this.intervalSec;
    return this.cfg;
  }

  async tick() {
    if (this.stopped) return;
    const now = nowSec();
    if (this.paused) {
      this.nextCycleAt = now + 2;
      this.schedule(2);
      return;
    }
    if (now < this.nextCycleAt) {
      this.schedule(Math.min(30, Math.max(1, this.nextCycleAt - now)));
      return;
    }
    try {
      await this.cycle();
    } catch (e) {
      this.logError(null, null, "cycle: " + (e && e.message ? e.message : e));
    }
    this.nextCycleAt = nowSec() + this.intervalSec;
    this.schedule(Math.min(30, Math.max(1, this.nextCycleAt - nowSec())));
  }

  async whoami(platform, refresh = false) {
    if (this.identity[platform] && !refresh) return this.identity[platform];
    let info;
    try {
      info = await this.im.adapter(platform).whoami();
    } catch (e) {
      info = { ok: false, self_id: null, name: null, detail: `${e?.name || "Error"}: ${e?.message || e}` };
    }
    info.platform = platform;
    info.checked_at = nowSec();
    this.identity[platform] = info;
    return info;
  }

  selfNames(platform) {
    const info = this.identity[platform] || {};
    const out = [];
    if (info.name) {
      out.push(info.name);
      for (const sep of ["(", "（"]) {
        if (info.name.includes(sep)) out.push(info.name.split(sep)[0]);
      }
    }
    return out.filter(Boolean);
  }

  async cycle({ force = false, note = "" } = {}) {
    if (this.cycleLock) return { ok: false, busy: true, reason: "上一轮还没跑完" };
    this.cycleLock = true;
    const t0 = Date.now();
    const platforms = this.cfg.platforms || ["feishu", "wecom"];
    let got = 0;
    let added = 0;
    let skipped = 0;
    let targets = [];
    try {
      for (const p of platforms) await this.whoami(p);
      if (this.cfg.poll?.refresh_chatlist !== false) await this.refreshChatlist(platforms);
      targets = this.candidates(platforms);
      for (const chat of targets) {
        if (this.stopped) break;
        const r = await this.pollChat(chat.platform, chat.chat_id, {
          name: chat.name, kind: chat.kind, force,
          dueAfter: force ? 0 : this.intervalSec,
        });
        if (r.fetched) {
          got += 1;
          added += Number(r.new) || 0;
        } else if (r.skipped) {
          skipped += 1;
        }
      }
      const now = nowSec();
      this.cycles += 1;
      this.lastCycleAt = now;
      this.lastCycleMs = Date.now() - t0;
      this.lastResult = {
        at: now, chats: got, new: added, skipped, targets: targets.length,
        force: !!force, note,
      };
      this.state.data.runtime = {
        cycles: this.cycles,
        last_cycle_at: this.lastCycleAt,
        last_cycle_ms: this.lastCycleMs,
        last_result: this.lastResult,
      };
      this.state.save();
      return { ok: true, ...this.lastResult };
    } finally {
      this.cycleLock = false;
    }
  }

  async refreshChatlist(platforms) {
    const limit = Math.max(20, Number(this.cfg.poll?.dm_recent) || 20);
    for (const p of platforms) {
      let r;
      try {
        r = await this.im.adapter(p).listChats(limit);
      } catch (e) {
        this.logError(p, null, `chat-list ${e?.name || "Error"}: ${e?.message || e}`);
        continue;
      }
      if (!r.ok) {
        if (r.error && !String(r.error).includes("不提供会话枚举")) {
          this.logError(p, null, "chat-list: " + String(r.error).slice(0, 200));
        }
        continue;
      }
      for (const c of r.items) {
        this.state.ensureChat(p, c.chat_id, { name: c.name, kind: c.kind });
      }
    }
  }

  candidates(platforms = this.cfg.platforms || []) {
    const out = [];
    for (const c of this.state.listChats()) {
      if (!platforms.includes(c.platform) || c.blocked || !c.watching) continue;
      const timer = Number(c.timer) || 0;
      if (c.kind === "group") {
        if (timer === 1) out.push(c);
      } else if (timer !== -1) {
        out.push(c);
      }
    }
    return out;
  }

  async pollChat(platform, chatId, {
    name = "", kind = "", force = false, dueAfter = 0, limit = 0, postTurn = false,
  } = {}) {
    const chat = this.state.ensureChat(platform, chatId, { name, kind });
    if (chat.blocked) return { fetched: false, blocked: true, skipped: "已屏蔽，不同步" };
    const now = nowSec();
    const cd = force ? 0 : Math.max(this.cooldownSec, Number(dueAfter) || 0);
    if (cd && now - (chat.last_sync || 0) < cd) {
      const left = Math.ceil(cd - (now - (chat.last_sync || 0)));
      return { fetched: false, skipped: `${left}s 内刚拉过` };
    }
    const baseline = !chat.last_epoch;
    if (!this.identity[platform]) await this.whoami(platform);
    const n = Math.max(1, Math.min(Number(limit) || this.cfg.poll?.per_chat_limit || 10, 50));
    let r;
    try {
      r = await this.im.adapter(platform).fetchMessages(chatId, { limit: n });
    } catch (e) {
      const msg = `${e?.name || "Error"}: ${e?.message || e}`.slice(0, 300);
      chat.last_error = msg;
      chat.last_sync = now;
      this.state.save();
      this.logError(platform, chat.name, "fetch " + msg);
      return { fetched: false, error: msg };
    }
    if (!r.ok) {
      const msg = String(r.error || "fetch failed").slice(0, 300);
      chat.last_error = msg;
      chat.last_sync = now;
      this.state.save();
      this.logError(platform, chat.name, msg);
      return { fetched: false, error: msg };
    }
    chat.last_error = "";
    chat.last_sync = now;
    const messages = r.messages.map((m) => ({
      ...m, platform, chat_id: chatId,
      is_self: !!this.identity[platform]?.self_id && m.sender_id === this.identity[platform].self_id,
    }));
    if (baseline && messages.length === 0) {
      chat.last_epoch = now;
      chat.last_ts = "";
      this.state.save();
      return { fetched: true, new: 0, msgs: 0, baseline: true, woke: false, items: [] };
    }
    const result = this.process(chat, messages, { baseline, platform });
    this.state.save();
    const woke = await this.maybeWake(chat, result.batch, postTurn);
    return {
      fetched: true, new: result.batch.length, msgs: messages.length,
      baseline, woke, items: messages,
    };
  }

  process(chat, messages, { baseline, platform }) {
    const selfId = this.identity[platform]?.self_id || "";
    const names = this.selfNames(platform);
    const floorEpoch = Number(chat.last_epoch) || 0;
    const selfEpoch = Math.max(0, ...messages
      .filter((m) => selfId && m.sender_id === selfId)
      .map((m) => Number(m.ts_epoch) || 0));
    let newestEpoch = Number(chat.last_epoch) || 0;
    let newestTs = chat.last_ts || "";
    const classified = [];
    for (const m of messages) { // 最新在前
      if ((Number(m.ts_epoch) || 0) > newestEpoch) {
        newestEpoch = Number(m.ts_epoch) || 0;
        newestTs = m.ts || "";
      }
      const isSelf = !!selfId && m.sender_id === selfId;
      let kind;
      if (isSelf) kind = "out";
      else if (chat.kind === "group") kind = isMention(m, selfId, names) ? "mention" : "fyi";
      else kind = "dm";
      let state;
      if (baseline) {
        state = isSelf ? "replied" : "ignored";
      } else if (isSelf) {
        state = "replied";
      } else if (selfEpoch && (Number(m.ts_epoch) || 0) < selfEpoch) {
        state = kind === "fyi" ? "ignored" : "replied";
      } else if (kind === "fyi") {
        state = "ignored";
      } else {
        state = "new";
      }
      const keepBody = (state === "new" || state === "opened") &&
        (kind === "dm" || kind === "mention" || kind === "service");
      classified.push({
        msg_id: String(m.msg_id),
        sender_id: String(m.sender_id || ""),
        sender_name: String(m.sender_name || ""),
        content: keepBody ? String(m.content || "") : "",
        ts: String(m.ts || ""),
        ts_epoch: Number(m.ts_epoch) || 0,
        kind,
        state,
      });
    }
    this.state.mergeRecent(chat, classified);
    if (!baseline && selfEpoch) this.state.markEarlierReplied(chat, selfEpoch);
    chat.last_epoch = newestEpoch || (baseline ? nowSec() : chat.last_epoch);
    chat.last_ts = newestTs;
    const batch = classified.filter((m) => {
      if ((Number(m.ts_epoch) || 0) <= floorEpoch) return false;
      if (m.kind !== "dm" && m.kind !== "mention" && m.kind !== "service") return false;
      const row = chat.recent.find((x) => x.msg_id === m.msg_id);
      return !!row && row.state === "new";
    });
    return { batch, selfEpoch };
  }

  async maybeWake(chat, batch, postTurn = false) {
    if (!chat.watching || chat.blocked) return false;
    const key = chatKey(chat.platform, chat.chat_id);
    const active = !!this.turns?.isActive(chat.platform, chat.chat_id);
    if (batch.length) {
      if (!this.turns) return false;
      const r = await this.turns.wake(chat, { interrupted: active, postTurn });
      return !!r.ok;
    }
    if (chat.wake?.failed && !active && this.state.pendingCount(chat) > 0 && this.turns) {
      const r = await this.turns.wake(chat, { retry: true, postTurn });
      return !!r.ok;
    }
    return false;
  }

  async fetchThread(platform, chatId, limit = 30) {
    if (!this.identity[platform]) await this.whoami(platform);
    try {
      const r = await this.im.adapter(platform).fetchMessages(chatId, {
        limit: Math.max(1, Math.min(limit, 100)), lookbackMin: 7 * 24 * 60,
      });
      if (!r.ok) return { ok: false, items: [], error: r.error || "fetch failed" };
      const selfId = this.identity[platform]?.self_id;
      return {
        ok: true,
        items: r.messages.map((m) => ({ ...m, platform, chat_id: chatId, is_self: !!selfId && m.sender_id === selfId })),
        error: "",
      };
    } catch (e) {
      return { ok: false, items: [], error: `${e?.name || "Error"}: ${e?.message || e}` };
    }
  }

  turnInfo(chat) {
    const active = this.turns?.snapshot?.()[chatKey(chat.platform, chat.chat_id)] || null;
    const last = chat.last_turn || {};
    return {
      state: active?.state || "idle",
      since: active?.since || 0,
      last_ok: active ? active.last_ok : (last.ok ?? null),
      last_reason: active ? (active.last_reason || "") : (last.reason || ""),
      last_at: active ? (active.last_at || 0) : (last.at || 0),
    };
  }

  instances() {
    const out = [];
    for (const c of this.state.serviceChats()) {
      const ti = this.turnInfo(c);
      out.push({
        platform: c.platform, chat_id: c.chat_id,
        name: c.name || c.chat_id, kind: c.kind || "p2p",
        workspace: c.workspace || "", dsh_session: c.dsh_session || "",
        session_bound_at: c.session_bound_at || 0, session_turns: c.session_turns || 0,
        turn_state: ti.state, turn_since: ti.since,
        last_ok: ti.last_ok, last_reason: ti.last_reason, last_at: ti.last_at,
        pending: this.state.pendingCount(c),
        watching: !!c.watching,
      });
    }
    return out;
  }

  pollInfo() {
    const p = this.cfg.poll || {};
    const rows = this.state.listChats();
    let targets = [];
    try { targets = this.candidates(this.cfg.platforms || []); } catch { targets = []; }
    return {
      interval_min: Number(p.interval_min) || 10,
      interval_sec: this.intervalSec,
      min_interval_min: 10,
      dm_scope: p.dm_scope || "recent",
      dm_recent: Number(p.dm_recent) || 20,
      cooldown_sec: this.cooldownSec,
      next_cycle_at: this.nextCycleAt,
      due_in: Math.max(0, Math.floor(this.nextCycleAt - nowSec())),
      timer_dm: targets.filter((t) => (t.kind || "p2p") === "p2p").length,
      timer_group: targets.filter((t) => t.kind === "group").length,
      groups: rows.filter((r) => r.kind === "group").length,
      blocked: rows.filter((r) => r.blocked).length,
      blocked_dm: rows.filter((r) => r.blocked && (r.kind || "p2p") === "p2p").length,
      blocked_group: rows.filter((r) => r.blocked && r.kind === "group").length,
      last_result: this.lastResult,
    };
  }

  async status() {
    const platforms = this.cfg.platforms || ["feishu", "wecom"];
    const pf = [];
    for (const p of platforms) {
      const ident = await this.whoami(p);
      const rows = this.state.listChats().filter((r) => r.platform === p);
      const watched = rows.filter((r) => r.watching);
      const lastSyncs = rows.map((r) => r.last_sync).filter(Boolean);
      const errs = this.errors.filter((e) => e.platform === p);
      const meta = PLATFORM_META[p] || {};
      pf.push({
        platform: p, label: meta.label || p, color: meta.color || "#888",
        cli: this.im.cliPath(p),
        logged_in: !!ident.ok, self_id: ident.self_id || null,
        self_name: ident.name || null, detail: ident.detail || "",
        chats: rows.length, watched: watched.length, service: watched.length,
        blocked: rows.filter((r) => r.blocked).length,
        last_sync: lastSyncs.length ? Math.max(...lastSyncs) : 0,
        errors: errs.length, last_error: errs[0]?.msg || "",
      });
    }
    return {
      running: this.started && !this.paused,
      paused: this.paused,
      started_at: this.startedAt,
      uptime: Math.floor(nowSec() - this.startedAt),
      cycles: this.cycles,
      last_cycle_at: this.lastCycleAt,
      last_cycle_ms: this.lastCycleMs,
      next_cycle_at: this.nextCycleAt,
      poll_interval: this.intervalSec,
      poll: this.pollInfo(),
      platforms: pf,
      counts: this.state.counts(),
      errors: this.errors.slice(0, 8),
      dsh: this.dshStatus(),
      instances: this.instances(),
      turns: this.turns?.snapshot?.() || {},
    };
  }

  dshStatus() {
    const ok = !!this.turns?.hostReady?.();
    return {
      engine: "dsh", configured: ok, dsh_ready: ok,
      label: ok ? "跟随 DSH 配置" : "DSH 宿主未就绪",
    };
  }

  async doctor() {
    const checks = [];
    for (const p of this.cfg.platforms || ["feishu", "wecom"]) {
      const ident = await this.whoami(p, true);
      const meta = PLATFORM_META[p] || {};
      const ok = !!ident.ok && !!ident.self_id;
      checks.push({
        platform: p, label: meta.label || p, level: ok ? "ok" : "fail",
        name: "身份与授权",
        detail: String(ident.detail || "").slice(0, 200) || `self_id=${ident.self_id}`,
        self_name: ident.name || null,
      });
      let adapter;
      try { adapter = this.im.adapter(p); } catch { continue; }
      const rows = this.state.listChats().filter((r) => r.platform === p && !r.blocked);
      const probe = rows.find((r) => r.watching) || rows[0] || null;
      if (probe) {
        try {
          const r = await adapter.fetchMessages(probe.chat_id, { limit: 3 });
          checks.push({
            platform: p, label: meta.label || p, level: r.ok ? "ok" : "fail",
            name: "拉取通路",
            detail: r.ok ? `最近 ${r.messages.length} 条 · ${probe.name}` : String(r.error || "fetch failed").slice(0, 200),
          });
        } catch (e) {
          checks.push({
            platform: p, label: meta.label || p, level: "fail", name: "拉取通路",
            detail: `${e?.name || "Error"}: ${e?.message || e}`.slice(0, 200),
          });
        }
      }
    }
    const dsh = this.dshStatus();
    checks.push({
      platform: "dsh", label: "值守会话",
      level: dsh.configured ? "ok" : "warn", name: "DSH 宿主",
      detail: dsh.label,
    });
    const sp = skillPath();
    if (!fs.existsSync(sp)) {
      checks.push({
        platform: "skill", label: "skill", level: "warn", name: "skill 路径",
        detail: `找不到 ${sp}；agent 能回但拿不到平台细节`,
      });
    }
    checks.push({
      platform: "poll", label: "拉取节奏", level: "ok", name: "定时拉取",
      detail: `${Math.floor(this.intervalSec / 60)} 分钟一轮 · 私聊 ${this.candidates(this.cfg.platforms || []).length} 个 · 群按点开才拉`,
    });
    return { checked_at: nowSec(), checks };
  }

  logError(platform, chat, msg) {
    this.errors.unshift({
      ts: nowSec(), platform: platform || null, chat: chat || null,
      msg: String(msg || "").slice(0, 400),
    });
    this.errors = this.errors.slice(0, 40);
    this.lastErrorAt = nowSec();
  }
}
