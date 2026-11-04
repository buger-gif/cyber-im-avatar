/**
 * poller.js — 值守的「耳朵」。
 *
 * 两条车道：快车道每 60 秒只拉值守候选（私聊 + 勾了 timer=1 的群）；
 * 慢车道每 10 分钟做发现（whoami + 会话列表）并补拉一轮。屏蔽的一律不拉。
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
import { chatKey, RECENT_LIMIT, SUPPORTED_PLATFORMS } from "./state.js";


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
    this.fastAt = 0;
    this.lastFast = {};
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

  /** 快车道间隔（秒）。0 = 关闭，只跑慢车道。 */
  get fastSec() {
    const n = Number(this.cfg?.poll?.fast_sec);
    if (n === 0) return 0;
    if (!Number.isFinite(n) || n <= 0) return Math.min(60, this.intervalSec);
    return Math.max(20, Math.min(n, this.intervalSec));
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
    const full = now >= this.nextCycleAt;
    try {
      if (full) {
        await this.cycle();
        this.nextCycleAt = nowSec() + this.intervalSec;
      } else if (this.fastSec > 0) {
        await this.fastCycle();
      }
    } catch (e) {
      this.logError(null, null, (full ? "cycle: " : "fast cycle: ") +
        (e && e.message ? e.message : e));
    }
    try {
      await this.maybeWarm();
    } catch (e) {
      this.logError(null, null, "warm: " + (e && e.message ? e.message : e));
    }
    this.scheduleNext();
  }

  /**
   * 值守心跳：续上下文缓存 + 让 agent 归并画像。
   * 一次 tick 最多启动一个，避免整点同时叫醒一批会话；只在「已绑定、已消费首轮载荷、
   * 没有待回、闲置在重开阈值内」的会话上跑，失败也按 warm_min 退避。
   */
  async maybeWarm() {
    const turns = this.turns;
    const cfg = this.cfg?.dsh || {};
    const warmMin = Math.max(0, Number(cfg.warm_min) || 0);
    if (!warmMin || !turns?.hostReady?.()) return false;
    const idleMin = Math.max(0, Number(cfg.idle_reset_min) || 0);
    const now = nowSec();
    const platforms = this.cfg.platforms || [];
    for (const chat of this.state.listChats()) {
      if (!chat.watching || chat.blocked || !chat.dsh_session) continue;
      if (!platforms.includes(chat.platform)) continue;
      if (chat.prompt_session !== chat.dsh_session) continue;
      // 和候选口径一致：不轮询的会话不会再有唤醒，焐它没有意义。
      const timer = Number(chat.timer) || 0;
      if (chat.kind === "group" ? timer !== 1 : timer === -1) continue;
      if (this.state.pendingCount(chat) > 0) continue;
      if (turns.isActive(chat.platform, chat.chat_id)) continue;
      const lastReal = Math.max(Number(chat.last_turn?.at) || 0,
        Number(chat.session_bound_at) || 0);
      if (!lastReal) continue;
      const idle = now - lastReal;
      if (idle < warmMin * 60) continue;
      // 快到重开阈值就不再焐：下一条消息会直接换新会话。
      if (idleMin > 0 && idle >= idleMin * 60) continue;
      const lastWarm = Number(chat.last_warm_at) || 0;
      if (lastWarm && now - lastWarm < warmMin * 60) continue;
      const r = await turns.warm(chat);
      if (!r.ok && r.reason !== "running") {
        chat.last_warm_at = nowSec();
        chat.last_warm_ok = false;
        this.state.save();
      }
      return true;
    }
    return false;
  }

  scheduleNext() {
    const now = nowSec();
    const untilFull = Math.max(0, this.nextCycleAt - now);
    const step = this.fastSec > 0 ? this.fastSec : Math.min(30, untilFull || 30);
    const wait = untilFull > 0 && untilFull < step ? untilFull : step;
    this.schedule(Math.max(1, wait));
  }

  /**
   * 快车道：只拉既有候选，不做发现。错误由慢车道每轮记一次，
   * 这里不写 runtime、不刷会话列表——每分钟一次的事不能碰这两样。
   */
  async fastCycle() {
    if (this.cycleLock) return { ok: false, busy: true, reason: "上一轮还没跑完" };
    this.cycleLock = true;
    const t0 = Date.now();
    const platforms = this.cfg.platforms || ["feishu", "wecom"];
    const usable = [];
    let got = 0;
    let added = 0;
    let skipped = 0;
    let targets = [];
    try {
      for (const p of platforms) {
        const ident = await this.whoami(p);
        if (ident?.ok && ident.self_id) usable.push(p);
      }
      targets = this.candidates(usable);
      for (const chat of targets) {
        if (this.stopped) break;
        const pending = this.state.pendingCount(chat) > 0;
        const r = await this.pollChat(chat.platform, chat.chat_id, {
          name: chat.name, kind: chat.kind, force: pending,
          dueAfter: pending ? 0 : this.cooldownSec,
        });
        if (r.fetched) {
          got += 1;
          added += Number(r.new) || 0;
        } else if (r.skipped) {
          skipped += 1;
        }
      }
      this.fastAt = nowSec();
      this.lastFast = {
        at: this.fastAt, chats: got, new: added, skipped,
        targets: targets.length, ms: Date.now() - t0,
        paused_platforms: platforms.filter((p) => !usable.includes(p)),
      };
      return { ok: true, ...this.lastFast };
    } finally {
      this.cycleLock = false;
    }
  }

  async whoami(platform, refresh = false) {
    const cached = this.identity[platform];
    // 失败不永久缓存：同一轮里短时间复用（避免 status/poll 连打），下一轮重试。
    if (cached && !refresh) {
      if (cached.ok && cached.self_id) return cached;
      if ((nowSec() - Number(cached.checked_at || 0)) < 5) return cached;
    }
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
      const usable = [];
      for (const p of platforms) {
        const ident = await this.whoami(p);
        if (ident?.ok && ident.self_id) {
          usable.push(p);
        } else {
          // 没有 self_id 时，本人消息会被判成对方；宁可这一轮不拉，也不自回环。
          this.logError(p, null, "身份不可用，已暂停该平台拉取：" +
            String(ident?.detail || "whoami 未返回 self_id").slice(0, 200));
        }
      }
      if (this.cfg.poll?.refresh_chatlist !== false) await this.refreshChatlist(usable);
      targets = this.candidates(usable);
      for (const chat of targets) {
        if (this.stopped) break;
        // 仍有待回时不受 cooldown 限制：点开只读不推进水位，别让积压等到下一轮。
        const pending = this.state.pendingCount(chat) > 0;
        const r = await this.pollChat(chat.platform, chat.chat_id, {
          name: chat.name, kind: chat.kind, force: force || pending,
          // 冷却只看 cooldown_sec；调度本身已经把定时轮隔到 interval_min。
          dueAfter: force || pending ? 0 : this.cooldownSec,
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
        paused_platforms: platforms.filter((p) => !usable.includes(p)),
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
    // 飞书 +chat-list 的 --page-size 实测上限 100；配置允许 200 只是面板口径。
    const limit = Math.max(20, Math.min(Number(this.cfg.poll?.dm_recent) || 20, 100));
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

  /** state 里存在、但插件不认识平台：保留数据，不拉取。 */
  legacyPlatforms() {
    const out = new Set();
    for (const c of this.state.listChats()) {
      if (!SUPPORTED_PLATFORMS.includes(c.platform)) out.add(c.platform);
    }
    return [...out];
  }

  async pollChat(platform, chatId, {
    name = "", kind = "", force = false, dueAfter = 0, limit = 0, wake = true,
  } = {}) {
    const chat = this.state.ensureChat(platform, chatId, { name, kind });
    if (chat.blocked) return { fetched: false, blocked: true, skipped: "已屏蔽，不同步" };
    const now = nowSec();
    const cd = force ? 0 : Math.max(this.cooldownSec, Number(dueAfter) || 0);
    if (cd && now - (chat.last_sync || 0) < cd) {
      const left = Math.ceil(cd - (now - (chat.last_sync || 0)));
      return { fetched: false, skipped: `${left}s 内刚拉过` };
    }
    const baseline = !chat.last_epoch && !chat.last_msg_id;
    await this.whoami(platform);
    const ident = this.identity[platform];
    if (!ident?.ok || !ident.self_id) {
      const msg = "身份不可用，已暂停该平台拉取";
      chat.last_error = msg;
      this.state.save();
      this.logError(platform, chat.name, msg);
      return { fetched: false, error: msg };
    }
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
    const messages = r.messages.slice(0, n).map((m) => ({
      ...m, platform, chat_id: chatId,
      is_self: !!ident.self_id && m.sender_id === ident.self_id,
    }));
    if (baseline && messages.length === 0) {
      chat.last_epoch = now;
      chat.last_ts = "";
      this.state.save();
      return { fetched: true, new: 0, msgs: 0, baseline: true, woke: false, items: [] };
    }
    const result = this.process(chat, messages, {
      baseline, platform, advance: wake || baseline,
    });
    this.state.save();
    const woke = wake ? await this.maybeWake(chat, result.batch) : false;
    return {
      fetched: true, new: result.batch.length, msgs: messages.length,
      baseline, woke, items: messages,
    };
  }

  process(chat, messages, { baseline, platform, advance = true }) {
    const selfId = this.identity[platform]?.self_id || "";
    const names = this.selfNames(platform);
    const floorEpoch = Number(chat.last_epoch) || 0;
    const lastId = String(chat.last_msg_id || "");
    const indexOf = new Map(messages.map((m, i) => [String(m.msg_id), i]));
    const hasWatermark = !!lastId && indexOf.has(lastId);
    const stopAt = hasWatermark ? indexOf.get(lastId) : -1;
    const selfEpoch = Math.max(0, ...messages
      .filter((m) => selfId && m.sender_id === selfId)
      .map((m) => Number(m.ts_epoch) || 0));
    // 消息列表是最新在前；同秒多条时第一个最大的就是最新，不能只按 epoch 收口。
    let best = null;
    for (let i = 0; i < messages.length; i += 1) {
      const epoch = Number(messages[i].ts_epoch) || 0;
      if (epoch < floorEpoch) continue;
      if (!best || epoch > best.epoch) {
        best = { epoch, ts: String(messages[i].ts || ""), id: String(messages[i].msg_id) };
      }
    }
    const classified = [];
    const newIds = new Set();
    for (let i = 0; i < messages.length; i += 1) { // 最新在前
      const m = messages[i];
      const isNew = !baseline && (hasWatermark
        ? i < stopAt
        : (Number(m.ts_epoch) || 0) > floorEpoch);
      if (isNew) newIds.add(String(m.msg_id));
      const isSelf = !!selfId && m.sender_id === selfId;
      const allMode = chat.kind === "group" && chat.wake_mode === "all";
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
        // 全量模式：群里的非 @ 消息也要叫醒 agent（只看不回），所以记 new。
        state = allMode ? "new" : "ignored";
      } else {
        state = "new";
      }
      const keepBody = (state === "new" || state === "opened") && kind !== "out";
      classified.push({
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
        media_paths: Array.isArray(m.media_paths) ? m.media_paths : [],
      });
    }
    this.state.mergeRecent(chat, classified);
    if (!baseline && selfEpoch) this.state.markEarlierReplied(chat, selfEpoch);
    // 点开只读（wake=false）不推进水位：这次发现的新消息留给下一轮定时唤醒，
    // 否则 batch 会被“看过”吞掉，永远不会叫醒 agent。
    if (advance) {
      if (best) {
        chat.last_epoch = best.epoch;
        chat.last_ts = best.ts;
        chat.last_msg_id = best.id;
      } else if (baseline && !messages.length) {
        chat.last_epoch = nowSec();
        chat.last_ts = "";
      }
    }
    const batch = this.collectBatch(chat, classified, newIds);
    return { batch, selfEpoch };
  }

  /**
   * 唤醒批次。
   * · mention 模式：只收本轮新到、仍是 new 的待回消息（水位已推进，天然不重复）。
   * · all 模式：合并窗口内的消息留在本地等下一轮，所以按 last_wake_epoch 去重，
   *   把积压的一次性给过去。上限就是本地保留的 10 条指针，更大的突发量按 skill 在线拉。
   */
  collectBatch(chat, classified, newIds) {
    const pendings = new Set(["dm", "mention", "service", "fyi"]);
    const allMode = chat.kind === "group" && chat.wake_mode === "all";
    if (!allMode) {
      return classified.filter((m) => {
        if (!newIds.has(m.msg_id)) return false;
        if (m.kind !== "dm" && m.kind !== "mention" && m.kind !== "service") return false;
        const row = chat.recent.find((x) => x.msg_id === m.msg_id);
        return !!row && row.state === "new";
      });
    }
    const floor = Number(chat.last_wake_epoch) || 0;
    return (chat.recent || [])
      // opened 也算：点开看过不等于 agent 已经处理过，靠 last_wake_epoch 去重即可。
      .filter((m) => pendings.has(m.kind) && (m.state === "new" || m.state === "opened") &&
        (Number(m.ts_epoch) || 0) > floor)
      .sort((a, b) => (a.ts_epoch - b.ts_epoch))
      .slice(-RECENT_LIMIT);
  }

  async maybeWake(chat, batch) {
    if (!chat.watching || chat.blocked) return false;
    const key = chatKey(chat.platform, chat.chat_id);
    const active = !!this.turns?.isActive(chat.platform, chat.chat_id);
    const allMode = chat.kind === "group" && chat.wake_mode === "all";
    if (allMode && batch.length) {
      // 合并窗口：窗口内攒着，下一轮一次给过去。窗口 0 = 不合并。
      const win = Math.max(0, Number(this.cfg.poll?.group_wake_sec ?? 60) || 0);
      const since = nowSec() - (Number(chat.last_wake_at) || 0);
      if (win > 0 && chat.last_wake_at && since < win) return false;
    }
    if (batch.length) {
      if (!this.turns) return false;
      const r = await this.turns.wake(chat, { interrupted: active, batch });
      if (r.ok && allMode) {
        chat.last_wake_at = nowSec();
        chat.last_wake_epoch = Math.max(...batch.map((m) => Number(m.ts_epoch) || 0));
        this.state.save();
      }
      return !!r.ok;
    }
    if (chat.wake?.failed && !active && this.state.pendingCount(chat) > 0 && this.turns) {
      const r = await this.turns.wake(chat, { interrupted: active });
      return !!r.ok;
    }
    return false;
  }

  async fetchThread(platform, chatId, limit = 30) {
    await this.whoami(platform);
    const n = Math.max(1, Math.min(Number(limit) || 30, 50));
    // 企微只有时间窗（最多 7 天）；飞书没有时间回看参数，不传。
    const lookbackMin = platform === "wecom"
      ? Math.min(7 * 24 * 60, Math.max(5, (Number(this.cfg.poll?.backfill_hours) || 72) * 60))
      : undefined;
    try {
      const r = await this.im.adapter(platform).fetchMessages(chatId, {
        limit: n, lookbackMin,
      });
      if (!r.ok) return { ok: false, items: [], error: r.error || "fetch failed" };
      const selfId = this.identity[platform]?.self_id;
      return {
        ok: true,
        items: r.messages.slice(0, n).map((m) => ({ ...m, platform, chat_id: chatId, is_self: !!selfId && m.sender_id === selfId })),
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
        last_warm_at: c.last_warm_at || 0, last_warm_ok: c.last_warm_ok ?? null,
        last_reset: c.last_reset || { at: 0, reason: "" },
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
      fast_sec: this.fastSec,
      fast_at: this.fastAt,
      last_fast: this.lastFast,
      min_interval_min: 10,
      dm_scope: p.dm_scope || "recent",
      dm_recent: Number(p.dm_recent) || 20,
      cooldown_sec: this.cooldownSec,
      group_wake_sec: Math.max(0, Number(p.group_wake_sec ?? 60) || 0),
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
    const enabledList = this.cfg.platforms || ["feishu", "wecom"];
    const pf = [];
    for (const p of SUPPORTED_PLATFORMS) {
      const enabled = enabledList.includes(p);
      const rows = this.state.listChats().filter((r) => r.platform === p);
      const watched = rows.filter((r) => r.watching);
      const lastSyncs = rows.map((r) => r.last_sync).filter(Boolean);
      const errs = this.errors.filter((e) => e.platform === p);
      const meta = PLATFORM_META[p] || {};
      // 未启用的平台不跑 whoami：没装 CLI 的人不该在体检页看到一条假的授权失败。
      const ident = enabled ? await this.whoami(p) : { ok: false, self_id: null, name: null, detail: "未启用" };
      pf.push({
        platform: p, label: meta.label || p, color: meta.color || "#888",
        enabled,
        cli: this.im.cliPath(p),
        logged_in: enabled && !!ident.ok, self_id: ident.self_id || null,
        self_name: ident.name || null, detail: ident.detail || "",
        identity_paused: enabled && !(ident.ok && ident.self_id),
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
      legacy_platforms: this.legacyPlatforms(),
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
    const enabled = this.cfg.platforms || ["feishu", "wecom"];
    for (const p of SUPPORTED_PLATFORMS) {
      const meta = PLATFORM_META[p] || {};
      if (!enabled.includes(p)) {
        checks.push({
          platform: p, label: meta.label || p, level: "warn", name: "未启用",
          detail: "在体检页启用后才会拉取；现在不占轮询、不跑 whoami",
        });
        continue;
      }
      const ident = await this.whoami(p, true);
      const ok = !!ident.ok && !!ident.self_id;
      checks.push({
        platform: p, label: meta.label || p, level: ok ? "ok" : "fail",
        name: "身份与授权",
        detail: ok
          ? (String(ident.detail || "").slice(0, 200) || `self_id=${ident.self_id}`)
          : `身份不可用，已暂停该平台拉取：${String(ident.detail || "whoami 未返回 self_id").slice(0, 180)}`,
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
    for (const p of this.legacyPlatforms()) {
      checks.push({
        platform: p, label: PLATFORM_META[p]?.label || p, level: "warn",
        name: "插件壳不支持",
        detail: "插件不认识这个平台；存量会话保留但不拉取、不唤醒。",
      });
    }
    const sp = skillPath();
    if (!fs.existsSync(sp)) {
      checks.push({
        platform: "skill", label: "skill", level: "warn", name: "skill 路径",
        detail: `找不到 ${sp}；agent 能回但拿不到平台细节`,
      });
    }
    const due = this.candidates(this.cfg.platforms || []);
    const dmCount = due.filter((c) => (c.kind || "p2p") === "p2p").length;
    checks.push({
      platform: "poll", label: "拉取节奏", level: "ok", name: "定时拉取",
      detail: this.fastSec > 0
        ? `值守 ${this.fastSec} 秒（${due.length} 个会话，约 ${due.length * Math.floor(86400 / this.fastSec)} 次/天）` +
          ` · 发现 ${Math.floor(this.intervalSec / 60)} 分钟（私聊 ${dmCount} / 群 ${due.length - dmCount}）`
        : `${Math.floor(this.intervalSec / 60)} 分钟一轮（快车道已关） · 定时轮询 ${due.length} 个会话` +
          `（私聊 ${dmCount} / 群 ${due.length - dmCount}）`,
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
