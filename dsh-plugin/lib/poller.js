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
import { chatKey, emptyCommandReply, SUPPORTED_PLATFORMS } from "./state.js";
import * as duty from "./duty.js";
import * as workspaces from "./workspaces.js";
import {
  commandEnabled, commandRow, isStartCommand, normalizeKeyword, replyText,
} from "./command.js";

/**
 * 跨会话找启动指令的间隔与回看窗口：一次 CLI 搜索代替逐会话轮询。
 * 1 分钟一跳（与快车道同频），回看 3 分钟覆盖一次 tick 的抖动与重叠；消息按 msg_id 幂等。
 */
const COMMAND_SCAN_SEC = 60;
const COMMAND_SCAN_LOOKBACK_SEC = 180;

/**
 * 账号级消息流（spec 0065）：一条搜索覆盖所有值守会话，快车道不再逐会话拉。
 * 窗口留 120 秒，吸收平台 create_time 的分钟精度与索引延迟。
 */
const STREAM_LOOKBACK_SEC = 120;
const STREAM_MAX_PAGES = 4;
const STREAM_MAX_IDS = 100;
/** 慢车道对账：每轮最多核对多少个会话（按最久没核对排序；30 个会话 10 分钟全覆盖）。 */
const VERIFY_MAX_PER_CYCLE = 30;
/** 区间读最多回看 2 小时；更早的记缺口，不回放。 */
const INTERVAL_MAX_SEC = 2 * 3600;
/** 单轮投递上限；多的留在待投集合里下一轮 drain。 */
const DELIVER_BATCH = 30;


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
    // 启动指令：同一会话同时只允许一个启动流程；扫描节流与最近一次结果只在内存。
    this.dutyStarts = new Map();
    this.commandScanAt = 0;
    this.lastCommandScan = {
      at: 0, ok: null, scanned: 0, matched: 0, started: 0, failed: 0, ms: 0, error: "",
    };
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
      await this.maybeCommandScan();
    } catch (e) {
      this.logError(null, null, "command: " + (e && e.message ? e.message : e));
    }
    try {
      await this.maybeDuty();
    } catch (e) {
      this.logError(null, null, "duty: " + (e && e.message ? e.message : e));
    }
    try {
      this.maybeClose();
    } catch (e) {
      this.logError(null, null, "close: " + (e && e.message ? e.message : e));
    }
    try {
      this.maybeRetire();
    } catch (e) {
      this.logError(null, null, "retire: " + (e && e.message ? e.message : e));
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

  chatBusy(chat) {
    return typeof this.turns?.busy === "function"
      ? this.turns.busy(chat.platform, chat.chat_id)
      : !!this.turns?.isActive?.(chat.platform, chat.chat_id);
  }

  /**
   * 任务完成收尾：保活轮标记后给 N 天观察。观察期内任何新命中 / 待回 / 在飞 / 手动活动
   * 都取消收尾；到期没有新活才退役。和 maybeRetire 共用 tick，不跑模型。
   */
  maybeClose() {
    const days = Math.max(0, Number(this.dutyCfg().close_after_days) || 0);
    const now = nowSec();
    let changed = 0;
    for (const chat of this.state.listChats()) {
      if (chat.duty?.state !== "closing") continue;
      if (!days) {
        if (duty.cancelClosing(chat, { now, reason: "任务完成收尾已关闭" })) changed += 1;
        continue;
      }
      if (!chat.watching || chat.blocked) continue;
      // 保活轮本身不是新活：它跑到一半时不要取消收尾，也不要把它当关闭障碍。
      if (this.turns?.warmActive?.(chat.platform, chat.chat_id)) continue;
      const mark = Number(chat.duty.decided_at) || 0;
      const newWork = this.state.pendingCount(chat) > 0 ||
        chat.wake?.active || chat.progress?.state === "running" || this.chatBusy(chat) ||
        Number(chat.duty.last_hit_at) > mark ||
        Number(chat.last_turn?.at) > mark ||
        Number(chat.last_wake_at) > mark;
      if (newWork) {
        if (duty.cancelClosing(chat, { now, reason: "有新活动，取消收尾" })) changed += 1;
        continue;
      }
      const closeAt = Number(chat.duty.close_at) || 0;
      if (!closeAt) {
        if (duty.cancelClosing(chat, { now, reason: "收尾截止缺失，取消收尾" })) changed += 1;
        continue;
      }
      if (now < closeAt) continue;
      const event = String(chat.duty.event_id || "");
      if (!duty.retire(chat, { now, days, reason: `任务已完成，${days} 天无新活` })) continue;
      if (event) {
        try { fs.unlinkSync(duty.decisionPath(this.state, event)); } catch { /* best effort */ }
      }
      changed += 1;
    }
    if (changed) {
      this.state.save();
      this.logger.info?.(`[im-standin] task-done closing: ${changed} chat(s) updated`);
    }
    return changed;
  }

  /**
   * 自动退役：连续 N 天没有命中 → 退出值守。和保温共用后台维护节拍，但不依赖保温窗口、
   * 不依赖 DSH 宿主、不跑模型；只扫 state，一次 save。待回 / 在飞 / 试用中的会话不动。
   */
  maybeRetire() {
    const days = Math.max(0, Number(this.dutyCfg().retire_after_days) || 0);
    if (!days) return 0;
    const now = nowSec();
    const floor = now - days * 86400;
    let retired = 0;
    for (const chat of this.state.listChats()) {
      if (!chat.watching || chat.blocked) continue;
      const st = chat.duty?.state || "none";
      if (["queued", "triaging", "trial", "reviewing", "closing"].includes(st)) continue;
      if (this.state.pendingCount(chat) > 0) continue;
      if (chat.wake?.active) continue;
      if (chat.progress?.state === "running") continue;
      if (this.chatBusy(chat)) continue;
      const last = duty.activityAt(chat);
      if (!last || last > floor) continue;
      const event = String(chat.duty?.event_id || "");
      if (!duty.retire(chat, { now, days })) continue;
      // 旧决策文件不能再把刚退役的会话拉回值守。
      if (event) {
        try { fs.unlinkSync(duty.decisionPath(this.state, event)); } catch { /* best effort */ }
      }
      retired += 1;
    }
    if (retired) {
      this.state.save();
      this.logger.info?.(`[im-standin] auto-retired ${retired} duty chat(s) after ${days}d without a hit`);
    }
    return retired;
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
  /** 平台是否支持账号级消息流（目前只有飞书）。 */
  streamable(chat) {
    if (!chat || chat.platform !== "feishu") return false;
    try { return !!this.im.adapter("feishu").supportsMessageStream; } catch { return false; }
  }

  /**
   * 快车道：一条账号级消息流覆盖所有值守会话（spec 0065）。
   * 没有流能力的平台保持逐会话区间读；还没基线的会话先补一次基线，不叫醒。
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
    let stream = null;
    let targets = [];
    try {
      for (const p of platforms) {
        const ident = await this.whoami(p);
        if (ident?.ok && ident.self_id) usable.push(p);
      }
      targets = this.candidates(usable);
      // 没有读取游标的先补一次基线 / 追赶（老数据从 last_epoch 读起），下一跳再进流。
      for (const c of targets) {
        if (!c.poll_since && (c.last_epoch || c.last_msg_id)) {
          c.poll_since = Math.max(1, Number(c.last_epoch) || (nowSec() - 60));
        }
      }
      const fresh = targets.filter((c) => !c.poll_since);
      const streamTargets = targets.filter((c) => this.streamable(c) && c.poll_since);
      const legacyTargets = targets.filter((c) => !streamTargets.includes(c) && !fresh.includes(c));
      for (const chat of fresh) {
        if (this.stopped) break;
        const r = await this.pollChat(chat.platform, chat.chat_id, {
          name: chat.name, kind: chat.kind, force: true,
        });
        if (r.fetched) got += 1;
      }
      for (const chat of legacyTargets) {
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
      if (!this.stopped && streamTargets.length) {
        stream = await this.streamTick(streamTargets);
        if (stream?.ok) {
          got += Number(stream.chats) || 0;
          added += Number(stream.new) || 0;
        } else if (stream?.skipped) {
          skipped += 1;
        }
      }
      this.fastAt = nowSec();
      this.lastFast = {
        at: this.fastAt, chats: got, new: added, skipped,
        targets: targets.length, stream, ms: Date.now() - t0,
        paused_platforms: platforms.filter((p) => !usable.includes(p)),
      };
      return { ok: true, ...this.lastFast };
    } finally {
      this.cycleLock = false;
    }
  }

  /**
   * 一次搜索覆盖所有值守会话。命中按会话分组写进待投集合，再各自唤醒。
   * 截断（has_more=true）时追加一次 `--is-at-me` 兜住 @；搜索失败降级为逐会话区间读。
   */
  async streamTick(targets) {
    const t0 = Date.now();
    const adapter = this.im.adapter("feishu");
    const runtime = this.state.data.runtime || (this.state.data.runtime = {});
    const prev = runtime.stream && typeof runtime.stream === "object" ? runtime.stream : {};
    const now = nowSec();
    const since = Number(prev.since) || 0;
    const start = since > 0
      ? Math.max(since - 2, now - 24 * 3600)
      : Math.max(0, now - STREAM_LOOKBACK_SEC);
    // 停机超过 24 小时：只回看一天，更早的记一笔截断，不假装读过。
    const capped = since > 0 && since < now - 24 * 3600;
    const ids = targets.map((c) => c.chat_id);
    // 单次过滤列表别太长：超过 100 个会话就分批发，别静默丢后半截。
    const chunks = [];
    for (let i = 0; i < ids.length; i += STREAM_MAX_IDS) chunks.push(ids.slice(i, i + STREAM_MAX_IDS));
    const collected = [];
    let complete = true;
    let r = { ok: true, items: [], complete: true };
    for (const chunk of chunks) {
      let one;
      try {
        one = await adapter.searchMessages({
          chatIds: chunk, start: new Date(start * 1000), end: new Date(now * 1000),
          pageLimit: STREAM_MAX_PAGES,
        });
      } catch (e) {
        one = { ok: false, error: `${e?.name || "Error"}: ${e?.message || e}` };
      }
      if (!one.ok) { r = one; break; }
      collected.push(...one.items);
      if (one.complete === false) complete = false;
    }
    if (r.ok) r = { ok: true, items: collected, complete };
    if (!r.ok) {
      const error = String(r.error || "stream failed").slice(0, 200);
      runtime.stream = { ...prev, at: now, ok: false, error, scanned: 0, matched: 0 };
      this.logError("feishu", null, "stream: " + error);
      // 降级：这一轮逐会话区间读补一次，宁可一次尖峰也不静默。
      let fallback = 0;
      for (const chat of targets) {
        if (this.stopped) break;
        const res = await this.pollChat(chat.platform, chat.chat_id, {
          name: chat.name, kind: chat.kind, force: true, source: "stream_fallback",
        });
        if (res.fetched) fallback += 1;
      }
      return { ok: false, skipped: true, error, fallback, ms: Date.now() - t0 };
    }
    const byId = new Map(targets.map((c) => [String(c.chat_id), c]));
    const groups = new Map();
    let matched = 0;
    for (const m of r.items) {
      const chat = byId.get(String(m.chat_id));
      if (!chat || chat.blocked) continue;
      if (!groups.has(chat.chat_id)) groups.set(chat.chat_id, []);
      groups.get(chat.chat_id).push(m);
      matched += 1;
    }
    let chats = 0;
    let added = 0;
    const touched = new Set();
    for (const [chatId, items] of groups) {
      if (this.stopped) break;
      touched.add(String(chatId));
      const res = await this.finishChat(byId.get(chatId), items, { source: "stream" });
      if (res.fetched) {
        chats += 1;
        added += Number(res.new) || 0;
      }
    }
    // 本轮没碰到的会话，若有上轮没投出去的行（唤醒失败 / 合并窗口），补一次 drain。
    // 本轮已经 wake 过的跳过：失败不在同一跳立刻重试，留给下一跳。
    for (const chat of targets) {
      if (this.stopped) break;
      if (touched.has(String(chat.chat_id))) continue;
      if (!chat.watching || chat.blocked) continue;
      if (!this.state.pendingUndelivered(chat, DELIVER_BATCH).length) continue;
      await this.maybeWake(chat);
    }
    const maxTs = r.items.reduce((n, m) => Math.max(n, Number(m.ts_epoch) || 0), 0);
    runtime.stream = {
      since: maxTs > 0 ? Math.max(maxTs, start) : Math.max(Number(prev.since) || 0, now - STREAM_LOOKBACK_SEC),
      at: now, ok: true, error: "", scanned: r.items.length, matched,
      truncated_at: (r.complete === false || capped) ? now : (Number(prev.truncated_at) || 0),
      // 对账计数由 finishChat 写在本轮里，这里不能覆盖掉。
      missed: Number(runtime.stream?.missed) || Number(prev.missed) || 0,
    };
    this.state.save();
    if (r.complete === false) await this.streamOverflow(targets, start, now);
    return {
      ok: true, scanned: r.items.length, matched, chats, new: added,
      complete: r.complete, ms: Date.now() - t0,
    };
  }

  /** 流被截断时只保证 @：一次跨会话 @我 搜索，其余靠慢车道对账。 */
  async streamOverflow(targets, start, end) {
    const adapter = this.im.adapter("feishu");
    const ids = targets.map((c) => c.chat_id);
    const chunks = [];
    for (let i = 0; i < ids.length; i += STREAM_MAX_IDS) chunks.push(ids.slice(i, i + STREAM_MAX_IDS));
    const items = [];
    for (const chunk of chunks) {
      let r;
      try {
        r = await adapter.searchAtMe({
          start: new Date(start * 1000), end: new Date(end * 1000), chatIds: chunk,
        });
      } catch (e) {
        r = { ok: false, error: `${e?.name || "Error"}: ${e?.message || e}` };
      }
      if (!r?.ok) {
        this.logError("feishu", null, "stream overflow at-me: " + String(r?.error || "failed").slice(0, 160));
        break; // 已拿到的分片照常补投，剩下的靠慢车道对账
      }
      items.push(...r.items);
    }
    const selfId = this.identity.feishu?.self_id || "";
    const names = this.selfNames("feishu");
    const byChat = new Map();
    for (const m of items) {
      if (!isMention(m, selfId, names)) continue;
      const chat = this.state.getChat("feishu", m.chat_id);
      if (!chat || chat.blocked || !chat.watching) continue;
      if (!byChat.has(m.chat_id)) byChat.set(m.chat_id, []);
      byChat.get(m.chat_id).push(m);
    }
    let n = 0;
    for (const [chatId, items] of byChat) {
      const chat = this.state.getChat("feishu", chatId);
      const res = await this.finishChat(chat, items, { source: "overflow" });
      if (res.fetched) n += 1;
    }
    return n;
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

  /**
   * 慢车道：发现新会话 + 对账。飞书会话不再逐会话轮询（快车道有流），
   * 这里按 `verified_at` 轮转做区间完整读，兜住流可能漏掉的消息（spec 0065）。
   */
  async cycle({ force = false, note = "" } = {}) {
    if (this.cycleLock) return { ok: false, busy: true, reason: "上一轮还没跑完" };
    this.cycleLock = true;
    const t0 = Date.now();
    const platforms = this.cfg.platforms || ["feishu", "wecom"];
    let got = 0;
    let added = 0;
    let skipped = 0;
    let targets = [];
    let verified = 0;
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
      const streamTargets = targets.filter((c) => this.streamable(c) && c.poll_since);
      const others = targets.filter((c) => !streamTargets.includes(c));
      for (const chat of others) {
        if (this.stopped) break;
        // 仍有待回时不受 cooldown 限制：点开只读不推进游标，别让积压等到下一轮。
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
      const due = streamTargets.slice()
        .sort((a, b) => (Number(a.verified_at) || 0) - (Number(b.verified_at) || 0))
        .slice(0, VERIFY_MAX_PER_CYCLE);
      for (const chat of due) {
        if (this.stopped) break;
        const r = await this.pollChat(chat.platform, chat.chat_id, {
          name: chat.name, kind: chat.kind, force: true, source: "verify",
        });
        if (r.fetched) {
          got += 1;
          added += Number(r.new) || 0;
          verified += 1;
        } else if (r.skipped) {
          skipped += 1;
        }
      }
      const now = nowSec();
      this.cycles += 1;
      this.lastCycleAt = now;
      this.lastCycleMs = Date.now() - t0;
      this.lastResult = {
        at: now, chats: got, new: added, skipped, targets: targets.length, verified,
        paused_platforms: platforms.filter((p) => !usable.includes(p)),
        force: !!force, note,
      };
      // 保留 runtime.stream 等字段：整块替换会把流游标一起清掉。
      this.state.data.runtime = {
        ...(this.state.data.runtime || {}),
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
    handleCommands = true, source = "poll",
  } = {}) {
    const chat = this.state.ensureChat(platform, chatId, { name, kind });
    if (chat.blocked) return { fetched: false, blocked: true, skipped: "已屏蔽，不同步" };
    const now = nowSec();
    const cd = force ? 0 : Math.max(this.cooldownSec, Number(dueAfter) || 0);
    if (cd && now - (chat.last_sync || 0) < cd) {
      const left = Math.ceil(cd - (now - (chat.last_sync || 0)));
      return { fetched: false, skipped: `${left}s 内刚拉过` };
    }
    await this.whoami(platform);
    const ident = this.identity[platform];
    if (!ident?.ok || !ident.self_id) {
      const msg = "身份不可用，已暂停该平台拉取";
      chat.last_error = msg;
      this.state.save();
      this.logError(platform, chat.name, msg);
      return { fetched: false, error: msg };
    }
    let adapter;
    try { adapter = this.im.adapter(platform); } catch (e) {
      const msg = `${e?.name || "Error"}: ${e?.message || e}`.slice(0, 300);
      chat.last_error = msg;
      this.state.save();
      this.logError(platform, chat.name, msg);
      return { fetched: false, error: msg };
    }
    // 存量会话没有 poll_since：从已有水位读起，别当成基线把升级期间的新消息吞掉。
    if (!chat.poll_since && (chat.last_epoch || chat.last_msg_id)) {
      chat.poll_since = Math.max(1, Number(chat.last_epoch) || (now - 60));
    }
    const baseline = !chat.last_epoch && !chat.last_msg_id;
    const interval = !baseline && !!chat.poll_since && !!adapter.supportsSince;
    const n = Math.max(1, Math.min(Number(limit) || this.cfg.poll?.per_chat_limit || 10, 50));
    let r;
    try {
      if (interval) {
        const floor = Math.max(chat.poll_since, now - INTERVAL_MAX_SEC);
        if (floor > chat.poll_since) {
          // 停机太久：只回看 2 小时，更早的记缺口，不回放。
          chat.gap = { at: now, from: chat.poll_since, to: floor, source: "backlog" };
        }
        r = await adapter.fetchSince(chatId, { since: floor, until: now, maxPages: 3 });
      } else {
        r = await adapter.fetchMessages(chatId, { limit: n });
      }
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
      // 面板只放一行结论；CLI 原文进宿主日志，排障时看日志。
      if (r.error_detail) {
        this.logger?.warn?.(`[im-standin] fetch ${platform}/${chatId}: ${r.error_detail}`);
      }
      return { fetched: false, error: msg };
    }
    chat.last_error = "";
    chat.last_sync = now;
    let messages = (r.messages || []).map((m) => ({
      ...m, platform, chat_id: chatId,
      is_self: !!ident.self_id && m.sender_id === ident.self_id,
    }));
    if (interval) {
      const epochs = messages.map((m) => Number(m.ts_epoch) || 0).filter((x) => x > 0);
      const newest = epochs.length ? Math.max(...epochs) : 0;
      if (r.complete === false) {
        // 窗口里没读全：把读不到的一段记成缺口，游标推到 now，不做无边界回放。
        chat.gap = {
          at: now, from: chat.poll_since,
          to: epochs.length ? Math.min(...epochs) : now, source: "backlog",
        };
        chat.poll_since = now;
      } else {
        chat.poll_since = Math.max(newest, now - 10);
      }
      chat.verified_at = now;
      // 区间读的条数由页预算决定（最多 150），不能再按 per_chat_limit 截断：
      // 截断会让游标跳到最新，把窗口里没处理的命中静默丢掉。
    } else if (baseline) {
      chat.poll_since = now - 10;
    }
    // 引用原文：只补水位之后的新消息，老消息不再重复 mget（spec 0053）。
    try {
      await adapter.resolveQuotes?.(messages, {
        since: baseline ? Number.POSITIVE_INFINITY : Math.max(0, (Number(chat.last_epoch) || 0) - 1),
      });
    } catch { /* 引用取不到不阻断轮询 */ }
    if (baseline && messages.length === 0) {
      chat.last_epoch = now;
      chat.last_ts = "";
      this.state.save();
      return { fetched: true, new: 0, msgs: 0, baseline: true, woke: false, items: [] };
    }
    return this.finishChat(chat, messages, {
      baseline, advance: wake || baseline, handleCommands, source,
    });
  }

  /**
   * 唤醒前补一次该会话的最近 10 条（只读）：账号流的结果没有 `reply_to`，
   * 这里把引用原文与媒体键贴回本批消息；取不到不阻断唤醒。
   */
  async enrichBatch(chat, rows) {
    let adapter;
    try { adapter = this.im.adapter(chat.platform); } catch { return rows; }
    if (!adapter?.fetchMessages || !rows?.length) return rows;
    try {
      const r = await adapter.fetchMessages(chat.chat_id, { limit: 10 });
      if (!r?.ok || !r.messages?.length) return rows;
      await adapter.resolveQuotes?.(r.messages, { since: 0 });
      const byId = new Map(r.messages.map((m) => [String(m.msg_id), m]));
      for (const row of rows) {
        const src = byId.get(String(row.msg_id));
        if (!src) continue;
        if (!row.reply_to && src.reply_to) row.reply_to = src.reply_to;
        if (!row.quote && src.quote) row.quote = src.quote;
        if (!row.media_id && src.media_id) row.media_id = src.media_id;
        if (!row.media_paths?.length && src.media_paths?.length) row.media_paths = src.media_paths;
      }
    } catch { /* 上下文取不到不阻断唤醒 */ }
    return rows;
  }

  /** 分类 → 待投集合 → （可选）指令 → 唤醒。轮询与账号流共用这一段。 */
  async finishChat(chat, messages, {
    baseline = false, advance = true, handleCommands = true, source = "poll",
  } = {}) {
    const platform = chat.platform;
    const ident = this.identity[platform];
    const now = nowSec();
    const items = (messages || []).map((m) => ({
      ...m, platform, chat_id: chat.chat_id,
      is_self: !!ident?.self_id && m.sender_id === ident.self_id,
    }));
    chat.last_sync = now;
    chat.last_error = "";
    const result = this.process(chat, items, { baseline, platform, advance });
    // 对账补回来的消息：流没见过的，记一笔健康度（spec 0065）。
    if (source === "verify" && result.newIds.size) {
      const rt = this.state.data.runtime || (this.state.data.runtime = {});
      rt.stream = rt.stream || {};
      rt.stream.missed = (Number(rt.stream.missed) || 0) + result.newIds.size;
    }
    this.state.save();
    const handled = handleCommands && advance
      ? await this.consumeStartCommands(chat, result.batch, { source })
      : { consumed: new Set(), results: [], started: false };
    const batch = handled.consumed.size
      ? result.batch.filter((m) => !handled.consumed.has(m.msg_id))
      : result.batch;
    // 账号流不带 reply_to：要唤醒时补一次最近 10 条，只补引用与媒体键，不改分类（spec 0065）。
    if (advance && batch.length && (source === "stream" || source === "overflow")) {
      await this.enrichBatch(chat, batch);
    }
    // 启动指令已经开了开场 turn：本批其它消息在 recent 里，别马上再起一轮把它打断。
    const woke = advance && !handled.started ? await this.maybeWake(chat, batch) : false;
    return {
      fetched: true, new: result.batch.length, msgs: items.length,
      baseline, woke, command: handled.results[0] || null, items, batch,
    };
  }

  process(chat, messages, { baseline, platform, advance = true }) {
    const selfId = this.identity[platform]?.self_id || "";
    const names = this.selfNames(platform);
    // 本人 @ 自己 = 对替身说话（spec 0029 / 0039）。它不是"已经回复了对面"，
    // 不该参与 selfEpoch——否则会把自己刚下指令时对面还没处理的 @ 吞掉。
    const isCmdMsg = (m) => !!selfId && m.sender_id === selfId &&
      isMention(m, selfId, names);
    const progressIds = new Set((chat.progress?.ids || []).map(String));
    const selfEpoch = Math.max(0, ...messages
      .filter((m) => selfId && m.sender_id === selfId && !isCmdMsg(m) &&
        !progressIds.has(String(m.msg_id)))
      .map((m) => Number(m.ts_epoch) || 0));
    // 水位只用于展示与旧数据兼容；「新不新」由 seen 环回答（spec 0065）。
    let best = null;
    for (const m of messages) {
      const epoch = Number(m.ts_epoch) || 0;
      if (!best || epoch > best.epoch) {
        best = { epoch, ts: String(m.ts || ""), id: String(m.msg_id) };
      }
    }
    const seen = new Set((chat.seen || []).map(String));
    const classified = [];
    const newIds = new Set();
    for (const m of messages) { // 最新在前
      const id = String(m.msg_id);
      // 进度卡是本人发的 Card，不是“本人已回复”；不进 recent/selfEpoch/newIds。
      if (progressIds.has(id)) continue;
      // 读过的不再分类：账号流与对账都会重读重叠区间（spec 0065）。
      if (advance && seen.has(id)) continue;
      if (!baseline) newIds.add(id);
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
      let skip = "";
      if (baseline) {
        state = isSelf ? "replied" : "ignored";
        skip = "baseline";
      } else if (kind === "cmd") {
        // 本人指令进批次，不当待回、不刷角标；正文保留给 agent 看。
        state = "new";
      } else if (isSelf) {
        state = "replied";
      } else if (kind === "fyi") {
        // 全量模式：群里的非 @ 消息也要叫醒 agent（只看不回），所以记 new。
        state = allMode ? "new" : "ignored";
        skip = allMode ? "" : "no-mention";
      } else {
        state = "new";
      }
      const keepBody = (state === "new" || state === "opened") && kind !== "out";
      classified.push({
        msg_id: id,
        sender_id: String(m.sender_id || ""),
        sender_name: String(m.sender_name || ""),
        content: keepBody ? String(m.content || "") : "",
        ts: String(m.ts || ""),
        ts_epoch: Number(m.ts_epoch) || 0,
        kind,
        state,
        skip,
        msg_type: String(m.msg_type || ""),
        app_link: String(m.app_link || ""),
        media_id: String(m.media_id || ""),
        media_paths: Array.isArray(m.media_paths) ? m.media_paths : [],
        reply_to: keepBody ? String(m.reply_to || "") : "",
        quote: keepBody && m.quote && typeof m.quote === "object" ? m.quote : null,
      });
    }
    // 值班活跃：只记「会叫醒分身」的新消息；本人消息、基线、群里的非 @ 闲聊不算。
    // 用消息自身时间而不是 now，补拉旧消息不会把退役时钟往后推。
    let hitEpoch = 0;
    for (const m of classified) {
      if (!newIds.has(m.msg_id)) continue;
      if (m.kind === "out" || m.kind === "cmd") continue;
      const hit = m.kind === "dm" || m.kind === "mention" || m.kind === "service" ||
        (chat.kind === "group" && chat.wake_mode === "all" && m.kind === "fyi");
      if (hit) hitEpoch = Math.max(hitEpoch, Number(m.ts_epoch) || 0);
    }
    if (hitEpoch) {
      chat.duty = chat.duty || {};
      chat.duty.last_hit_at = Math.max(Number(chat.duty.last_hit_at) || 0,
        Math.min(hitEpoch, nowSec()));
    }
    const newCmd = classified.some((m) => newIds.has(m.msg_id) && m.kind === "cmd");
    if ((hitEpoch || newCmd) && chat.duty?.state === "closing") {
      duty.cancelClosing(chat, { now: nowSec(), reason: "有新消息，取消收尾" });
    }
    this.state.mergeRecent(chat, classified);
    if (advance) this.state.markSeen(chat, messages.map((m) => String(m.msg_id)));
    // 只收口「已经给过 agent」的行：本人发言证明不了答过没投递的 @（spec 0065）。
    if (!baseline && selfEpoch) this.state.markEarlierReplied(chat, selfEpoch);
    // 点开只读（wake=false）不推进游标 / seen：这次发现的新消息留给下一轮定时唤醒，
    // 否则批次会被“看过”吞掉，永远不会叫醒 agent。
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
    const batch = this.state.pendingUndelivered(chat, DELIVER_BATCH);
    return { batch, newIds, selfEpoch };
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

  async maybeWake(chat, batch = null) {
    if (!chat.watching || chat.blocked) return false;
    const rows = Array.isArray(batch) ? batch : this.state.pendingUndelivered(chat, DELIVER_BATCH);
    if (rows.some((m) => m.kind === "cmd") && !this.allowCmdWake(chat)) return false;
    // 已被取消、正在收尾的旧轮不算在飞：它不该让新消息的载荷被标成「上一轮被打断」。
    const active = typeof this.turns?.busy === "function"
      ? this.turns.busy(chat.platform, chat.chat_id)
      : !!this.turns?.isActive(chat.platform, chat.chat_id);
    const allMode = chat.kind === "group" && chat.wake_mode === "all";
    // 指令是交互，不等合并窗口：窗口内的旁观消息仍按窗口攒着。
    const hasCmd = rows.some((m) => m.kind === "cmd");
    if (allMode && rows.length && !hasCmd) {
      // 合并窗口：窗口内攒着，下一轮一次给过去。窗口 0 = 不合并。
      const win = Math.max(0, Number(this.cfg.poll?.group_wake_sec ?? 60) || 0);
      const since = nowSec() - (Number(chat.last_wake_at) || 0);
      if (win > 0 && chat.last_wake_at && since < win) return false;
    }
    if (rows.length) {
      if (!this.turns) return false;
      // 纯 drain（这批消息都早于上次唤醒）不打断在飞轮次；有新命中才打断。
      const fresh = !chat.last_wake_at ||
        rows.some((m) => (Number(m.ts_epoch) || 0) > (Number(chat.last_wake_at) || 0));
      const r = await this.turns.wake(chat, { interrupted: active && fresh, batch: rows });
      if (r.ok) {
        chat.last_wake_at = nowSec();
        this.state.markDelivered(chat, rows.map((m) => m.msg_id));
        this.state.save();
      }
      return !!r.ok;
    }
    if (chat.wake?.failed && !active && this.state.pendingCount(chat) > 0 && this.turns) {
      const r = await this.turns.wake(chat, { interrupted: active });
      if (r.ok) {
        this.state.markDelivered(chat, this.state.pendingMessages(chat).map((m) => m.msg_id));
        this.state.save();
      }
      return !!r.ok;
    }
    return false;
  }

  // ---- 本人 @ 自己 + 关键词 = 启动值班（spec 0046） -------------------------

  /** 记一条命令结果；`starting` 不算终态，重启或下一轮可以重试。 */
  writeCommand(chat, msg, keyword, result, reason) {
    // 回执记录跨命令保留：下一条 already 不该把上一次「已发」的状态抹掉。
    const reply = chat.command?.reply && typeof chat.command.reply === "object"
      ? { ...emptyCommandReply(), ...chat.command.reply } : emptyCommandReply();
    chat.command = {
      at: nowSec(),
      keyword: normalizeKeyword(keyword),
      msg_id: String(msg?.msg_id || ""),
      result,
      reason: String(reason || "").slice(0, 160),
      reply,
    };
  }

  /**
   * 启动成功后在本会话回一条回执（spec 0048）。只在真正拉起值班时调用；
   * 失败不回滚 watching，只把原因记进 command.reply 并留一行日志。
   */
  async sendStartReply(chat) {
    const text = replyText(this.cfg.command);
    if (!text) return { ok: true, skipped: true };
    let out;
    try {
      out = await this.im.adapter(chat.platform).sendText(chat.chat_id, text);
    } catch (e) {
      out = { ok: false, error: `${e?.name || "Error"}: ${e?.message || e}` };
    }
    chat.command.reply = {
      at: nowSec(),
      ok: !!out?.ok,
      msg_id: String(out?.message_id || ""),
      error: out?.ok ? "" : String(out?.error || "send failed").slice(0, 160),
    };
    try { this.state.save(); } catch { /* 记录失败不影响值班 */ }
    if (!out?.ok) {
      this.logger.warn?.(`[im-standin] start reply ${chat.platform}:${chat.chat_id}: ` +
        chat.command.reply.error);
    }
    return out;
  }

  /**
   * 从一批消息里消费启动指令。真正开了会话的那条从唤醒批次移除；
   * 只处理最新一条未处理过的，重复消息按 msg_id 幂等。
   *
   * `already` 不消费：会话本来就在值班时，「我自己 @ 自己」仍然是一次 @ 命中，
   * 该照常交给 agent（spec 0039 的对替身说话），不能因为没新建会话就连正文一起吞掉。
   */
  async consumeStartCommands(chat, batch, { source = "poll" } = {}) {
    const cfg = this.cfg.command || {};
    if (!commandEnabled(cfg)) return { consumed: new Set(), results: [], started: false };
    const keyword = normalizeKeyword(cfg.start_keyword);
    const selfId = this.identity[chat.platform]?.self_id || "";
    const names = this.selfNames(chat.platform);
    const hits = (Array.isArray(batch) ? batch : [])
      .filter((m) => m && m.kind === "cmd" &&
        isStartCommand(m, { selfId, selfNames: names, keyword }))
      .sort((a, b) => (Number(b.ts_epoch) || 0) - (Number(a.ts_epoch) || 0));
    const consumed = new Set();
    const results = [];
    let started = false;
    for (const m of hits) {
      const r = await this.startDutyFromCommand(chat, m, { source, keyword });
      if (r?.deduped) {
        // 真开过会话的重复（扫描先命中、下一轮又捞到）不能再叫醒一次；
        // already 的重复没有副作用，照常往下交给 agent。
        if (r?.result === "started") consumed.add(String(m.msg_id));
        continue;
      }
      results.push(r);
      if (r?.result === "started") started = true;
      // already = 本来就在值班，没有可开的东西：这条不进 consumed，继续往下交给 agent。
      if (r?.result !== "already") consumed.add(String(m.msg_id));
      break;
    }
    return { consumed, results, started };
  }

  /**
   * 在指定会话启动值班。硬约束：同一 platform:chat_id 只能有一个值班会话。
   * 已绑定会话 / 正在启动 → 冲突，不再 open；空绑定只补开，不新建第二个。
   */
  async startDutyFromCommand(chat, msg, { source = "poll", keyword = "" } = {}) {
    if (!chat || !msg) return { ok: false, result: "failed", reason: "missing_chat" };
    const kw = normalizeKeyword(keyword || this.cfg.command?.start_keyword);
    if (!kw) return { ok: false, result: "failed", reason: "no_keyword" };
    const key = chatKey(chat.platform, chat.chat_id);
    const current = this.state.getChat(chat.platform, chat.chat_id) || chat;
    const prev = current.command || {};
    if (prev.msg_id === String(msg.msg_id) && prev.result && prev.result !== "starting") {
      return { ok: true, result: prev.result, reason: prev.reason, deduped: true };
    }
    if (this.dutyStarts.has(key)) {
      return { ok: false, result: "already", reason: "值班正在启动，没有重复创建" };
    }
    this.dutyStarts.set(key, true);
    try {
      if (current.blocked) {
        this.writeCommand(current, msg, kw, "blocked", "会话已屏蔽，不能启动值班");
        this.state.save();
        return { ok: false, result: "blocked", reason: current.command.reason };
      }
      const busy = typeof this.turns?.busy === "function"
        ? this.turns.busy(current.platform, current.chat_id)
        : !!this.turns?.isActive?.(current.platform, current.chat_id);
      // 已有一个值班会话：不新建第二个；关键词这条消息由开关消费，不再交给 agent。
      if (current.watching && current.dsh_session) {
        this.writeCommand(current, msg, kw, "already",
          "已在值班且已绑定会话，没有重复创建");
        this.state.save();
        return { ok: true, result: "already", reason: current.command.reason };
      }
      if (current.watching && busy) {
        this.writeCommand(current, msg, kw, "already", "值班正在启动，没有重复创建");
        this.state.save();
        return { ok: true, result: "already", reason: current.command.reason };
      }

      this.writeCommand(current, msg, kw, "starting", "正在启动值班");
      current.watching = true;
      current.target = true;
      current.timer = 1;
      if (current.kind === "group") {
        if (current.wake_mode !== "all") current.wake_mode = "mention";
      } else if (!["all", "mention"].includes(current.wake_mode)) {
        current.wake_mode = "all";
      }
      if (!current.send_mode) {
        current.send_mode = this.cfg.send_mode_default === "auto" ? "auto" : "draft";
      }
      if (!String(current.workspace || "").trim()) {
        const joinWs = workspaces.resolveJoinDefault(this.state.data.chats, this.cfg);
        if (joinWs) current.workspace = joinWs;
      }
      // 用户显式动作优先于排队 / 进行中的分诊：清掉事件，陈旧 ignore 决策不能把它再关掉。
      const d = current.duty || (current.duty = {});
      d.state = "watch";
      d.trigger = "manual";
      d.by = "user";
      d.decided_at = nowSec();
      d.reason = `你在 IM 里 @ 自己用「${kw}」启动值班`.slice(0, 160);
      d.confidence = 1;
      d.review_at = 0;
      d.error = "";
      d.attempts = 0;
      d.close_at = 0;
      d.event_id = "";
      d.event_at = 0;
      d.triaged_at = 0;
      // 指令可能来自未启用平台？飞书扫描只跑已启用平台；这里仍按面板加入的口径补启用。
      const enabled = this.cfg.platforms || [];
      if (!enabled.includes(current.platform)) {
        this.cfg.platforms = SUPPORTED_PLATFORMS
          .filter((p) => p === current.platform || enabled.includes(p));
      }
      this.state.save();

      // 跨会话搜索只拿到这一条指令：先补一次最近上下文（只读，不推进水位）。
      // 首次见到的会话 pollChat 会走 baseline 并清空正文，所以再取一次原始消息给开场
      // prompt 用；两个调用都失败时才退回只有指令本身。
      let contextMessages = null;
      if (source === "scan") {
        try {
          await this.pollChat(current.platform, current.chat_id, {
            name: current.name, kind: current.kind, force: true, wake: false,
            handleCommands: false,
          });
        } catch { /* 补不到上下文就用指令本身 */ }
        const selfId = this.identity[current.platform]?.self_id || "";
        const names = this.selfNames(current.platform);
        try {
          const raw = await this.fetchThread(current.platform, current.chat_id, 30);
          if (raw.ok && raw.items.length) {
            contextMessages = raw.items
              .map((m) => {
                const isSelf = !!selfId && m.sender_id === selfId;
                let kind = "dm";
                if (isSelf) {
                  kind = isStartCommand(m, { selfId, selfNames: names, keyword: kw })
                    ? "cmd" : "out";
                } else if (current.kind === "group") {
                  kind = isMention(m, selfId, names) ? "mention" : "fyi";
                }
                return {
                  ...m,
                  kind,
                  state: "new",
                  content: String(m.content || ""),
                  media_paths: Array.isArray(m.media_paths) ? m.media_paths : [],
                };
              })
              .sort((a, b) => (Number(b.ts_epoch) || 0) - (Number(a.ts_epoch) || 0))
              .slice(0, 10);
          }
        } catch { /* 取不到原文就用本地 recent 兜底 */ }
        if (current.kind !== "group" &&
            (current.name === current.chat_id || !current.name)) {
          const other = (contextMessages || current.recent || []).find((m) =>
            m.sender_id && m.sender_id !== selfId && String(m.sender_name || "").trim());
          if (other) current.name = String(other.sender_name).trim();
        }
      }

      let r;
      if (!this.turns?.open) {
        r = { ok: false, reason: "host_unavailable" };
      } else {
        const ctx = {
          command: { keyword: kw, msg_id: String(msg.msg_id || ""), source },
        };
        if (source === "scan") {
          if (contextMessages?.length) ctx.messages = contextMessages;
          else if (!this.turns.openMessages?.(current)?.length) ctx.messages = [commandRow(msg)];
        }
        try {
          r = await this.turns.open(current, { reason: "command", dutyContext: ctx });
        } catch (e) {
          r = { ok: false, reason: String(e?.message || e?.name || e).slice(0, 160) };
        }
      }
      if (r?.ok) {
        this.writeCommand(current, msg, kw, "started", "已在当前会话启动值班");
        try {
          this.turns?.profiles?.ensureMemory?.(
            current.platform, current, this.identity[current.platform]?.self_id || "");
        } catch { /* best effort */ }
        this.state.save();
        // 回执只在这里发：already / blocked / failed 都不该在会话里多一条消息。
        await this.sendStartReply(current);
        return { ok: true, result: "started", reason: current.command.reason, open: r };
      }
      const reason = String(r?.reason || "start_failed").slice(0, 160);
      this.writeCommand(current, msg, kw, "failed", "启动失败：" + reason);
      this.state.save();
      this.logger.warn?.(`[im-standin] command start ${key}: ${reason}`);
      return { ok: false, result: "failed", reason: current.command.reason, open: r };
    } finally {
      this.dutyStarts.delete(key);
    }
  }

  /**
   * 飞书跨会话找启动指令：每分钟一条搜索，覆盖未值守私聊 / 群 / 存量会话。
   * 只消费本地复核通过的「本人 + @本人 + 关键词」；搜索失败不影响轮询。
   */
  async maybeCommandScan({ force = false } = {}) {
    const cfg = this.cfg.command || {};
    if (!commandEnabled(cfg)) return false;
    if (!this.turns?.hostReady?.()) return false;
    if (!(this.cfg.platforms || []).includes("feishu")) return false;
    let adapter;
    const now = nowSec();
    try {
      adapter = this.im.adapter("feishu");
    } catch {
      adapter = null;
    }
    if (!adapter?.supportsSelfMentions) {
      this.commandScanAt = now;
      this.lastCommandScan = {
        ...this.lastCommandScan, at: now, ok: false,
        error: adapter ? "self_mentions_unavailable" : "adapter_unavailable",
      };
      return false;
    }
    if (!force && this.commandScanAt && now - this.commandScanAt < COMMAND_SCAN_SEC) return false;
    this.commandScanAt = now;
    const keyword = normalizeKeyword(cfg.start_keyword);
    const startedAt = Date.now();
    let scanned = 0;
    let matched = 0;
    let started = 0;
    let failed = 0;
    let error = "";
    try {
      let ident = this.identity.feishu;
      if (!ident?.ok || !ident.self_id) ident = await this.whoami("feishu");
      if (!ident?.ok || !ident.self_id) {
        error = "identity_unavailable";
      } else {
        const r = await adapter.searchSelfMentions({
          selfId: ident.self_id,
          start: new Date((now - COMMAND_SCAN_LOOKBACK_SEC) * 1000),
          end: new Date(now * 1000),
        });
        if (!r.ok) {
          error = String(r.error || "search_failed").slice(0, 200);
        } else {
          scanned = r.items.length;
          const names = this.selfNames("feishu");
          const seen = new Set();
          const jobs = [];
          for (const m of r.items.slice().sort((a, b) =>
            (Number(b.ts_epoch) || 0) - (Number(a.ts_epoch) || 0))) {
            if (!m?.chat_id || !m.msg_id || seen.has(m.msg_id)) continue;
            seen.add(m.msg_id);
            if (!isStartCommand(m, { selfId: ident.self_id, selfNames: names, keyword })) continue;
            let kind = m.chat_type === "group" ? "group"
              : (m.chat_type === "p2p" ? "p2p" : "");
            if (!kind) {
              const known = this.state.getChat("feishu", m.chat_id);
              kind = known?.kind === "group" ? "group" : (known?.kind === "p2p" ? "p2p" : "");
            }
            if (!kind) continue;
            const chat = this.state.ensureChat("feishu", m.chat_id, {
              name: m.chat_name || "", kind,
            });
            if (chat.blocked) continue;
            jobs.push({ chat, m });
          }
          matched = jobs.length;
          for (const { chat, m } of jobs.slice(0, 20)) {
            const res = await this.startDutyFromCommand(chat, m, { source: "scan", keyword });
            if (res?.result === "started") started += 1;
            if (res?.result === "failed") failed += 1;
          }
        }
      }
    } catch (e) {
      error = String(e?.message || e?.name || e).slice(0, 200);
      this.logger.warn?.(`[im-standin] command scan: ${error}`);
    }
    this.lastCommandScan = {
      at: now, ok: !error, scanned, matched, started, failed,
      ms: Date.now() - startedAt, error,
    };
    return true;
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
      const items = r.messages.slice(0, n).map((m) => ({
        ...m, platform, chat_id: chatId, is_self: !!selfId && m.sender_id === selfId,
      }));
      // 面板线程也显示引用原文；取不到就只留指针，不阻断。
      try { await this.im.adapter(platform).resolveQuotes?.(items); } catch { /* 引用取不到不阻断 */ }
      return { ok: true, items, error: "" };
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
      command_scan: { ...this.lastCommandScan },
      // 账号级消息流（spec 0065）：面板用它显示「一条流覆盖多少会话」与截断/失败。
      stream: {
        ...(this.state.data.runtime?.stream || {}),
        supported: this.streamable({ platform: "feishu" }),
      },
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
      // 本人是谁：值守台要能分清「有人被点名」和「你被点名」（spec 0051）。
      self_id: this.identity[chat.platform]?.self_id || "",
      self_name: this.identity[chat.platform]?.name || "",
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
    const eventId = d.event_id;
    // 用户可能在探针 / 查人数期间用启动指令接管：旧事件不能再覆盖 watch。
    const superseded = () => chat.duty !== d || d.by === "user" || d.event_id !== eventId;
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
    // 自动路径先在插件侧筛人数：超过上限、或平台根本给不出人数时，agent 只能 ignore，
    // 没必要为一次注定 ignore 的判断起 turn 花 token。手动事件保留（用户显式要求）。
    const limit = Number(this.dutyCfg().max_group_members) || 0;
    if (!review && d.trigger !== "manual") {
      let count = Number(chat.duty.member_count) || 0;
      if (!count) count = await this.memberCountFor(chat);
      if (limit > 0 && (count === 0 || count > limit)) {
        d.state = "ignore";
        d.by = "system";
        d.decided_at = nowSec();
        d.reason = count > 0
          ? `群成员 ${count} 超过自动上限 ${limit}`
          : "群成员数未知，自动只能 ignore";
        d.review_at = 0;
        d.error = "";
        d.attempts = 0;
        this.state.save();
        return { ok: true, skipped: count > 0 ? "group_too_large" : "member_unknown", count };
      }
    }
    if (superseded()) return { ok: false, reason: "superseded" };
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
    if (superseded()) return { ok: false, reason: "superseded" };
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
    // 启动指令是用户显式接管：陈旧分诊结果不能再把它关掉。
    if (d.by === "user") return;
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
              const dstate = chat.duty?.state || "none";
              // 存量群不自动重判；自动退役的群是新信号（退役后又有人 @），允许重新入队。
              if ((!baseline || Number(chat.added_at) <= baseline) && dstate !== "retired") continue;
              if (chat.blocked || chat.watching) continue;
              if (!["none", "ignore", "failed", "retired"].includes(dstate)) continue;
              if ((Number(m.ts_epoch) || 0) <= (Number(chat.duty?.sweep_epoch) || 0)) continue;
              // 用户手动停盯过：停盯时刻之前的 @ 视为已看过，不再重复入队。
              const dismissed = Number(chat.duty?.decided_at) || 0;
              if (chat.duty?.state === "ignore" && chat.duty?.by === "user"
                && dismissed > 0 && (Number(m.ts_epoch) || 0) <= dismissed) continue;
              if (!byChat.has(m.chat_id)) byChat.set(m.chat_id, { chat, newest: 0 });
              byChat.get(m.chat_id).newest = Math.max(byChat.get(m.chat_id).newest,
                Number(m.ts_epoch) || 0);
            }
            for (const { chat, newest } of byChat.values()) {
              duty.newEvent(chat, "sweep");
              chat.duty.last_hit_at = Math.max(Number(chat.duty.last_hit_at) || 0,
                Math.min(newest, nowSec()));
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
          const dstate = chat.duty?.state || "none";
          if ((!baseline || Number(chat.added_at) <= baseline) && dstate !== "retired") continue;
          if (!["none", "ignore", "failed", "retired"].includes(dstate)) continue;
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
            // 同上：手动停盯时刻之前的 @ 不重复分诊。
            const dismissed = Number(chat.duty?.decided_at) || 0;
            if (chat.duty?.state === "ignore" && chat.duty?.by === "user"
              && dismissed > 0 && ts <= dismissed) continue;
            newest = Math.max(newest, ts);
          }
          if (newest) {
            duty.newEvent(chat, "sweep");
            chat.duty.last_hit_at = Math.max(Number(chat.duty.last_hit_at) || 0,
              Math.min(newest, nowSec()));
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
