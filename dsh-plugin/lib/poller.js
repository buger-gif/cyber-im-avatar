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
import * as duty from "./duty.js";


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
    // 本人 @ 自己的唤醒时间：只用于防回环熔断，不落 state。
    this.cmdWakes = new Map();
    this.dutyLock = false;
    this.dutyLastCleanup = 0;
    this.lastSweep = { at: 0, ok: null, scanned: 0, queued: 0, error: "" };
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
      await this.maybeDuty();
    } catch (e) {
      this.logError(null, null, "duty: " + (e && e.message ? e.message : e));
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
   * 一段连续闲置最多保温一次：第一个 warm_min 到点跑，第二个 warm_min 到点就不再跑
   * （下一条真实消息会换新会话）。一次 tick 最多启动一个，失败也算一次，不按 tick 重试。
   */
  async maybeWarm() {
    const turns = this.turns;
    const cfg = this.cfg?.dsh || {};
    const warmMin = Math.max(0, Number(cfg.warm_min) || 0);
    if (!warmMin || !turns?.hostReady?.()) return false;
    const now = nowSec();
    const warmSec = warmMin * 60;
    const platforms = this.cfg.platforms || [];
    for (const chat of this.state.listChats()) {
      if (!chat.watching || chat.blocked || !chat.dsh_session) continue;
      if (!platforms.includes(chat.platform)) continue;
      if (!this.platformUsable(chat.platform)) continue;
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
      // 第一个周期还没到；或已经过了第二个周期，这通会话下一条消息就会换，别再花钱保温。
      if (idle < warmSec) continue;
      if (idle >= warmSec * 2) continue;
      // 这段闲置已经保温过一次：不再保第二次。
      const lastWarm = Number(chat.last_warm_at) || 0;
      if (lastWarm > lastReal) continue;
      const r = await turns.warm(chat);
      // 被真实消息取消不算一次保温；真正启动失败要记账，避免每个 tick 重试。
      if (!r.ok && r.reason !== "running" && r.reason !== "cancelled") {
        chat.last_warm_at = nowSec();
        chat.last_warm_ok = false;
        this.state.save();
      }
      return true;
    }
    return false;
  }

  /**
   * 平台身份可用才保温：授权掉了轮询已经暂停，这些会话再也不会被新消息唤醒，
   * 继续每 warm_min 起一轮真实模型调用只是白烧钱。
   * identity 还没填（首次 cycle 之前）时放行，交给本轮 cycle 的 whoami 判断。
   */
  platformUsable(platform) {
    const ident = this.identity?.[platform];
    if (!ident) return true;
    return !!(ident.ok && ident.self_id);
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

  /** 该平台能不能判定「@ 我」（结构化 mentions，或本人显示名兜底）。 */
  canMention(platform) {
    try {
      return !!this.im.adapter(platform).canMention;
    } catch {
      return false;
    }
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
    const desk = this.state.data.desk || (this.state.data.desk = {});
    const baselineBefore = Number(desk.baseline_at) || 0;
    const fullBefore = Number(desk.full_baseline_at) || 0;
    // 首轮，或从 0.18.0 只拉了第一页升上来：先把全部已有群登记成存量。
    const needFull = !baselineBefore || !fullBefore;
    const baselineIds = new Set(Array.isArray(desk.baseline_group_ids) ? desk.baseline_group_ids : []);
    let anyOk = false;
    let fullFailed = false;
    let queued = 0;
    let fullIds = null;
    for (const p of platforms) {
      if (needFull && p === "feishu") {
        // 完整基线只取群，不把 3k+ p2p 灌进 state；结果只用于 baseline_group_ids。
        try {
          const all = await this.im.adapter(p).listChats(100, { all: true });
          if (all.ok) {
            fullIds = [...new Set(all.items
              .filter((c) => c.kind === "group")
              .map((c) => String(c.chat_id || ""))
              .filter(Boolean))];
          } else {
            fullFailed = true;
            if (all.error) this.logError(p, null, "chat-list full: " + String(all.error).slice(0, 200));
          }
        } catch (e) {
          fullFailed = true;
          this.logError(p, null, `chat-list full ${e?.name || "Error"}: ${e?.message || e}`);
        }
      }
      // 日常列表始终走一页，用来维护面板/候选；完整基线只额外记 ID，不建 3k 个 chat。
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
      anyOk = true;
      for (const c of r.items) {
        const existed = !!this.state.getChat(p, c.chat_id);
        const oldBaseline = !existed && baselineIds.has(String(c.chat_id || ""));
        // 不在 state 里的完整基线圈：日常刷新不再建行，直接跳过。
        if (oldBaseline && !needFull) continue;
        const chat = this.state.ensureChat(p, c.chat_id, { name: c.name, kind: c.kind });
        if (needFull || !baselineBefore || !this.cfg.duty?.enabled) continue;
        if (chat.kind !== "group" || chat.blocked || chat.watching) continue;
        if (chat.duty?.state && chat.duty.state !== "none") continue;
        if (oldBaseline) continue;
        if (existed && Number(chat.added_at) <= baselineBefore) continue;
        if (!existed || chat.duty?.state === "none") {
          duty.newEvent(chat, "added");
          queued += 1;
        }
      }
    }
    let fullSet = false;
    let cleared = 0;
    if (anyOk && needFull && !fullFailed) {
      const now = nowSec();
      if (!baselineBefore) desk.baseline_at = now;
      desk.full_baseline_at = now;
      if (fullIds) desk.baseline_group_ids = fullIds.slice(0, 10000);
      fullSet = true;
      // 升级清理：0.18.0 把第一页之后的旧群排成了 added 事件；完整登记后这些不是新群。
      if (baselineBefore && !fullBefore) {
        for (const c of this.state.listChats()) {
          if (!["queued", "triaging"].includes(c.duty?.state) || c.duty?.trigger !== "added") continue;
          c.duty.state = "none";
          c.duty.trigger = "";
          c.duty.event_id = "";
          c.duty.event_at = 0;
          c.duty.triaged_at = 0;
          c.duty.attempts = 0;
          c.duty.error = "";
          cleared += 1;
        }
      }
      this.logger.info?.(`[im-standin] duty full baseline at ${now}` +
        (fullIds ? `; ${fullIds.length} groups in snapshot` : "") +
        (cleared ? `; cleared ${cleared} queued added event(s)` : ""));
    }
    if (queued || fullSet) this.state.save();
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
    // 本人 @ 自己 = 对替身说话（spec 0029 / 0039）。它不是"已经回复了对面"，
    // 不该参与 selfEpoch——否则会把自己刚下指令时对面还没处理的 @ 吞掉。
    const isCmdMsg = (m) => !!selfId && m.sender_id === selfId &&
      isMention(m, selfId, names);
    const selfEpoch = Math.max(0, ...messages
      .filter((m) => selfId && m.sender_id === selfId && !isCmdMsg(m))
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
      // 私聊「只认 @」：非 @ 记知会，正文不落盘、不算待回、不进唤醒批次。
      const dmMention = chat.kind !== "group" && chat.wake_mode === "mention";
      let kind;
      if (isSelf) kind = isCmdMsg(m) ? "cmd" : "out";
      else if (chat.kind === "group") kind = isMention(m, selfId, names) ? "mention" : "fyi";
      else if (dmMention) kind = isMention(m, selfId, names) ? "dm" : "fyi";
      else kind = "dm";
      let state;
      if (baseline) {
        state = isSelf ? "replied" : "ignored";
      } else if (kind === "cmd") {
        // 本人指令进批次，不当待回、不刷角标；正文保留给 agent 看。
        state = "new";
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
    const pendings = new Set(["dm", "mention", "service", "fyi", "cmd"]);
    const allMode = chat.kind === "group" && chat.wake_mode === "all";
    if (!allMode) {
      return classified.filter((m) => {
        if (!newIds.has(m.msg_id)) return false;
        if (m.kind !== "dm" && m.kind !== "mention" && m.kind !== "service" &&
            m.kind !== "cmd") return false;
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

  /**
   * 本人指令的防回环熔断：同一会话 10 分钟最多 5 次 cmd 唤醒。
   * 一旦 agent 的回复里也 @ 了自己，每轮都会带一条 cmd；不拦会无限烧 token。
   * 超限写 chat.last_error（面板与 /api/logs 可见），窗口过后自然恢复。
   */
  allowCmdWake(chat) {
    const key = chatKey(chat.platform, chat.chat_id);
    const now = nowSec();
    const win = 600;
    const max = 5;
    const list = (this.cmdWakes.get(key) || []).filter((t) => now - t < win);
    if (list.length >= max) {
      const msg = `本人指令 10 分钟内超过 ${max} 条，已暂停唤醒（疑似回环）`;
      if (chat.last_error !== msg) {
        chat.last_error = msg;
        this.state.save();
        this.logError(chat.platform, chat.name, msg);
      }
      return false;
    }
    list.push(now);
    this.cmdWakes.set(key, list);
    return true;
  }

  async maybeWake(chat, batch) {
    if (!chat.watching || chat.blocked) return false;
    if (batch.some((m) => m.kind === "cmd") && !this.allowCmdWake(chat)) return false;
    const key = chatKey(chat.platform, chat.chat_id);
    // 已被取消、正在收尾的旧轮不算在飞：它不该让新消息的载荷被标成「上一轮被打断」。
    const active = typeof this.turns?.busy === "function"
      ? this.turns.busy(chat.platform, chat.chat_id)
      : !!this.turns?.isActive(chat.platform, chat.chat_id);
    const allMode = chat.kind === "group" && chat.wake_mode === "all";
    // 指令是交互，不等合并窗口：窗口内的旁观消息仍按窗口攒着。
    const hasCmd = batch.some((m) => m.kind === "cmd");
    if (allMode && batch.length && !hasCmd) {
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

  // ---- 值守分诊（spec 0040） ------------------------------------------------
  dutyCfg() {
    return this.cfg.duty || {};
  }

  async memberCountFor(chat) {
    let r;
    try {
      r = await this.im.adapter(chat.platform).chatMembers(chat.chat_id);
    } catch (e) {
      r = { ok: false, known: false, count: 0, error: String(e?.message || e) };
    }
    chat.duty = chat.duty || {};
    chat.duty.member_count = r.ok && r.known && Number(r.count) > 0 ? Number(r.count) : 0;
    return chat.duty.member_count;
  }

  /**
   * 一次性探针：拉 10 条、消费水位、查人数。review 只读、不消费。
   * 返回原始消息（未清正文）；失败抛错，由 startTriage 记账。
   */
  async probeForDuty(chat, { review = false, readOnly = false } = {}) {
    await this.whoami(chat.platform);
    const ident = this.identity[chat.platform];
    if (!ident?.ok || !ident.self_id) throw new Error("identity_unavailable");
    const r = await this.im.adapter(chat.platform).fetchMessages(chat.chat_id, { limit: 10 });
    if (!r.ok) throw new Error(String(r.error || "fetch failed").slice(0, 200));
    const messages = r.messages.slice(0, 10).map((m) => ({
      ...m, platform: chat.platform, chat_id: chat.chat_id,
      is_self: !!ident.self_id && m.sender_id === ident.self_id,
    }));
    const baseline = !chat.last_epoch && !chat.last_msg_id;
    const names0 = this.selfNames(chat.platform);
    const anyMention = messages.some((m) => !m.is_self && isMention(m, ident.self_id, names0));
    for (const m of messages) {
      m.kind = m.is_self ? "out" : (isMention(m, ident.self_id, names0) ? "mention" : "fyi");
    }
    if (!review && !readOnly) {
      this.process(chat, messages, { baseline, platform: chat.platform, advance: true });
      if (anyMention && chat.duty?.trigger === "added") chat.duty.trigger = "mentioned";
      const newest = Math.max(Number(chat.last_epoch) || 0,
        ...messages.map((m) => Number(m.ts_epoch) || 0));
      chat.duty = chat.duty || {};
      chat.duty.sweep_epoch = Math.max(Number(chat.duty.sweep_epoch) || 0, newest);
    } else if (!review) {
      // sweep 只更新自己的水位；不写 recent / last_sync / 正常水位。
      const newest = Math.max(Number(chat.duty?.sweep_epoch) || 0,
        ...messages.map((m) => Number(m.ts_epoch) || 0));
      chat.duty = chat.duty || {};
      chat.duty.sweep_epoch = newest;
    }
    await this.memberCountFor(chat);
    if (!review && !readOnly) chat.last_sync = nowSec();
    this.state.save();
    return messages;
  }

  dutyFacts(chat) {
    const d = chat.duty || {};
    const cfg = this.dutyCfg();
    const recent = this.state.listChats()
      .filter((c) => c !== chat && c.duty?.decided_at > 0)
      .sort((a, b) => (b.duty.decided_at - a.duty.decided_at))
      .slice(0, 5)
      .map((c) => ({
        name: c.name || c.chat_id,
        action: c.duty.state,
        reason: c.duty.reason || "",
      }));
    return {
      platform: chat.platform,
      label: PLATFORM_META[chat.platform]?.label || chat.platform,
      name: chat.name || chat.chat_id,
      chat_id: chat.chat_id,
      trigger: d.trigger || "manual",
      member_count: Number(d.member_count) || 0,
      member_limit: Number(cfg.max_group_members) || 0,
      watch_groups: duty.watchGroups(this.state),
      watch_max: Number(cfg.max_groups) || 0,
      quota_used: duty.quotaUsed(this.state),
      quota_max: Number(cfg.max_per_day) || 0,
      recent,
      policy_path: path.join(duty.dutyDir(this.state), "policy.md"),
      decision_path: duty.decisionPath(this.state, d.event_id),
      trial_hours: Number(cfg.trial_hours) || 0,
      review_at: Number(d.review_at) || 0,
    };
  }

  async startTriage(chat, { review = false } = {}) {
    const d = chat.duty;
    if (!d || !d.event_id) return { ok: false, reason: "no_event" };
    if (!this.turns?.hostReady?.()) return { ok: false, reason: "host_unavailable" };
    // 决策文件已经写好（上一轮回调丢了 / 进程重启）：先应用，不重复起 turn。
    const early = await duty.consumeDecision({
      state: this.state, chat, turns: this.turns, profiles: this.turns?.profiles || null, im: this.im,
    });
    if (early.ok) return { ok: true, applied: true };
    if (early.error && early.error !== "no_decision") {
      if (review) {
        d.attempts = Math.max(1, Number(d.attempts) || 0) + 1;
        this.state.save();
      }
      return { ok: false, reason: early.error };
    }
    d.state = "triaging";
    d.attempts = Math.max(0, Number(d.attempts) || 0) + 1;
    if (!review) d.triaged_at = nowSec();
    d.error = "";
    this.state.save();
    let messages;
    try {
      messages = await this.probeForDuty(chat, { review, readOnly: review || d.trigger === "sweep" });
    } catch (e) {
      const reason = String(e?.message || e).slice(0, 160);
      d.state = review ? "trial" : ((d.attempts >= 2) ? "failed" : "queued");
      d.error = reason;
      this.state.save();
      return { ok: false, reason };
    }
    const facts = this.dutyFacts(chat);
    const r = await this.turns.deskTriage(chat, {
      eventId: d.event_id, trigger: d.trigger, review, messages, facts,
      onDone: () => this.finishTriage(chat, { review, messages }),
    });
    if (!r.ok) {
      d.state = review ? "trial" : ((d.attempts >= 2) ? "failed" : "queued");
      d.error = String(r.reason || "desk_unavailable").slice(0, 160);
      this.state.save();
    }
    return r;
  }

  async finishTriage(chat, { review = false, messages = [] } = {}) {
    const current = this.state.getChat(chat.platform, chat.chat_id);
    if (!current) return;
    const d = current.duty;
    if (!d) return;
    const r = await duty.consumeDecision({
      state: this.state, chat: current, turns: this.turns, profiles: this.turns?.profiles || null, im: this.im,
      contextMessages: messages,
    });
    if (r.ok) {
      d.error = "";
      this.state.save();
      return;
    }
    if (r.error === "no_decision") {
      const stale = review && d.review_at && nowSec() > d.review_at + 3600;
      if (review && stale) {
        current.watching = false;
        current.timer = -1;
        d.state = "ignore";
        d.by = "system";
        d.decided_at = nowSec();
        d.reason = "试用期满未复核";
        d.review_at = 0;
        d.error = "";
        this.state.save();
        return;
      }
      d.state = (d.attempts >= 2) ? "failed" : (review ? "trial" : "queued");
      d.error = d.attempts >= 2 ? "no_decision" : "no_decision_retry";
      this.state.save();
      return;
    }
    if (!["no_decision", "no_decision_retry"].includes(r.error)) {
      d.state = review ? "trial" : "failed";
      d.error = r.error;
      this.state.save();
    }
  }

  async maybeTriage() {
    if (this.turns?.deskBusy?.()) return false;
    const queued = this.state.listChats()
      .filter((c) => c.duty?.state === "queued")
      .sort((a, b) => (a.duty.event_at - b.duty.event_at));
    if (!queued.length) return false;
    const cfg = this.dutyCfg();
    if (!cfg.enabled && queued.every((c) => c.duty.trigger !== "manual")) return false;
    if (Number(cfg.max_per_day) > 0 && duty.quotaUsed(this.state) >= Number(cfg.max_per_day)) {
      const manual = queued.find((c) => c.duty.trigger === "manual");
      if (!manual) return false;
      await this.startTriage(manual);
      return true;
    }
    const chat = queued.find((c) => c.duty.trigger === "manual") || queued[0];
    if (chat.blocked) {
      chat.duty.state = "failed";
      chat.duty.error = "blocked";
      this.state.save();
      return true;
    }
    if (chat.duty.trigger !== "manual" && !cfg.enabled) return false;
    await this.startTriage(chat);
    return true;
  }

  async maybeReview() {
    if (this.turns?.deskBusy?.()) return false;
    const due = this.state.listChats()
      .filter((c) => c.duty?.state === "trial" && c.duty.review_at > 0 &&
        c.duty.review_at <= nowSec())
      .sort((a, b) => a.duty.review_at - b.duty.review_at);
    if (!due.length) return false;
    const chat = due[0];
    if (Number(chat.duty.review_at) > 0 && nowSec() > Number(chat.duty.review_at) + 3600) {
      chat.watching = false;
      chat.timer = -1;
      chat.duty.state = "ignore";
      chat.duty.by = "system";
      chat.duty.decided_at = nowSec();
      chat.duty.reason = "试用到期未完成复核";
      chat.duty.review_at = 0;
      chat.duty.error = "";
      this.state.save();
      return true;
    }
    if (Number(chat.duty.attempts) >= 2) {
      chat.watching = false;
      chat.timer = -1;
      chat.duty.state = "ignore";
      chat.duty.by = "system";
      chat.duty.decided_at = nowSec();
      chat.duty.reason = "试用复核两次失败";
      chat.duty.review_at = 0;
      chat.duty.error = "";
      this.state.save();
      return true;
    }
    if (!this.dutyCfg().enabled) {
      chat.watching = false;
      chat.timer = -1;
      chat.duty.state = "ignore";
      chat.duty.by = "system";
      chat.duty.decided_at = nowSec();
      chat.duty.reason = "试用到期，自动分诊已关闭";
      chat.duty.review_at = 0;
      this.state.save();
      return true;
    }
    duty.newReviewEvent(chat);
    this.state.save();
    await this.startTriage(chat, { review: true });
    return true;
  }

  async maybeSweep() {
    const cfg = this.dutyCfg();
    const desk = this.state.data.desk || {};
    const every = Number(cfg.sweep_min) || 0;
    if (!cfg.enabled || every <= 0) return false;
    if (!desk.baseline_at) return false;
    const last = Number(desk.last_sweep_at) || 0;
    if (last && nowSec() - last < every * 60) return false;
    desk.last_sweep_at = nowSec();
    this.state.save();
    const lookback = Math.max(1, Number(cfg.sweep_lookback_hours) || 24);
    const floor = nowSec() - lookback * 3600;
    const baseline = Number(desk.baseline_at) || 0;
    let scanned = 0;
    let queued = 0;
    let error = "";
    const platforms = this.cfg.platforms || [];
    try {
      if (platforms.includes("feishu")) {
        const adapter = this.im.adapter("feishu");
        if (adapter.supportsAtMe) {
          const r = await adapter.searchAtMe({ start: new Date(floor * 1000), end: new Date() });
          if (!r.ok) {
            error = String(r.error || "at_me_failed").slice(0, 200);
          } else {
            const ident = this.identity.feishu || await this.whoami("feishu");
            const names = this.selfNames("feishu");
            const byChat = new Map();
            for (const m of r.items) {
              scanned += 1;
              if (!isMention(m, ident.self_id, names)) continue;
              if ((Number(m.ts_epoch) || 0) < floor) continue;
              const chat = this.state.getChat("feishu", m.chat_id);
              if (!chat || chat.kind !== "group") continue;
              if (!baseline || Number(chat.added_at) <= baseline) continue;
              if (chat.blocked || chat.watching) continue;
              if (!["none", "ignore", "failed"].includes(chat.duty?.state || "none")) continue;
              if ((Number(m.ts_epoch) || 0) <= (Number(chat.duty?.sweep_epoch) || 0)) continue;
              if (!byChat.has(m.chat_id)) byChat.set(m.chat_id, { chat, newest: 0 });
              byChat.get(m.chat_id).newest = Math.max(byChat.get(m.chat_id).newest,
                Number(m.ts_epoch) || 0);
            }
            for (const { chat, newest } of byChat.values()) {
              duty.newEvent(chat, "sweep");
              chat.duty.sweep_epoch = Math.max(Number(chat.duty.sweep_epoch) || 0, newest);
              queued += 1;
            }
          }
        }
      }
      if (platforms.includes("dingtalk")) {
        // 钉钉没有跨群 @我 搜索：退回逐新群；成员数未知，后续自动只能 ignore。
        for (const chat of this.state.listChats()) {
          if (chat.platform !== "dingtalk" || chat.kind !== "group" || chat.blocked || chat.watching) continue;
          if (!baseline || Number(chat.added_at) <= baseline) continue;
          if (!["none", "ignore", "failed"].includes(chat.duty?.state || "none")) continue;
          let r;
          try {
            r = await this.im.adapter("dingtalk").fetchMessages(chat.chat_id, { limit: 10 });
          } catch { continue; }
          if (!r.ok) continue;
          const ident = this.identity.dingtalk || await this.whoami("dingtalk");
          const names = this.selfNames("dingtalk");
          let newest = 0;
          for (const m of r.messages) {
            scanned += 1;
            const ts = Number(m.ts_epoch) || 0;
            if (!isMention(m, ident.self_id, names) || ts < floor) continue;
            if (ts <= (Number(chat.duty?.sweep_epoch) || 0)) continue;
            newest = Math.max(newest, ts);
          }
          if (newest) {
            duty.newEvent(chat, "sweep");
            chat.duty.sweep_epoch = Math.max(Number(chat.duty.sweep_epoch) || 0, newest);
            queued += 1;
          }
        }
      }
    } catch (e) {
      error = String(e?.message || e).slice(0, 200);
      this.logError(null, null, "sweep: " + error);
    }
    if (queued) this.state.save();
    this.lastSweep = { at: desk.last_sweep_at, ok: !error, scanned, queued, error };
    return true;
  }

  async maybeDuty() {
    if (this.dutyLock || !this.turns) return;
    this.dutyLock = true;
    try {
      const now = nowSec();
      if (!this.dutyLastCleanup || now - this.dutyLastCleanup > 86400) {
        this.dutyLastCleanup = now;
        try {
          duty.ensureDutyDir(this.state);
          duty.cleanupDecisions(this.state, 7);
          duty.cleanupRecords(this.state, this.dutyCfg());
        } catch (e) {
          this.logError(null, null, "duty cleanup: " + (e?.message || e));
        }
      }
      await this.maybeReview();
      await this.maybeSweep();
      await this.maybeTriage();
    } finally {
      this.dutyLock = false;
    }
  }

  dutyInfo() {
    const cfg = this.dutyCfg();
    const counts = duty.dutyCounts(this.state);
    const desk = this.state.data.desk || {};
    const items = this.state.listChats()
      .filter((c) => (c.duty?.state || "none") !== "none")
      .sort((a, b) => (Number(b.duty.decided_at || b.duty.event_at) || 0) -
        (Number(a.duty.decided_at || a.duty.event_at) || 0))
      .slice(0, 100)
      .map((c) => ({
        platform: c.platform, chat_id: c.chat_id, name: c.name, kind: c.kind,
        watching: !!c.watching, pending: this.state.pendingCount(c),
        duty: { ...c.duty },
      }));
    return {
      ok: true, enabled: !!cfg.enabled,
      counts: {
        ...counts,
        quota_max: Number(cfg.max_per_day) || 0,
        watch_max: Number(cfg.max_groups) || 0,
      },
      desk: {
        session_id: String(desk.dsh_session || ""),
        workspace: path.join(duty.dutyDir(this.state)),
        session_turns: Number(desk.session_turns) || 0,
        session_max_turns: Number(cfg.session_max_turns) || 0,
        last_turn: desk.last_turn || { ok: null, reason: "", at: 0 },
        last_error: String(desk.last_error || ""),
        baseline_at: Number(desk.baseline_at) || 0,
        full_baseline_at: Number(desk.full_baseline_at) || 0,
        last_sweep_at: Number(desk.last_sweep_at) || 0,
      },
      last_sweep: this.lastSweep,
      items,
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
    const di = this.dutyInfo();
    checks.push({
      platform: "duty", label: "值守分诊", level: "ok", name: "候选与值守台",
      detail: `${di.counts.queued} 排队 / ${di.counts.trial} 试用 / ${di.counts.watch} 值守 · ` +
        `今日 ${di.counts.quota_used}/${di.counts.quota_max || "不限"} · ` +
        `值守台 ${di.desk.session_turns} 次判断（每次新建） · ` +
        `上次 @ 清查 ${di.desk.last_sweep_at ? new Date(di.desk.last_sweep_at * 1000).toLocaleString() : "未跑"}`,
    });
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
