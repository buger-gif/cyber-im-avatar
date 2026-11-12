/**
 * app.js — 面板 API（与 web/panel.js 的现有契约保持一致）。
 *
 * 这里不再有 Python 进程/SQLite；所有读写在 state.json + profiles/*.md，
 * 在线正文走平台 CLI。
 */
import { publicConfig, normalizeConfig, SUPPORTED_PLATFORMS, SEND_MODES } from "./state.js";
import { isMention } from "./im.js";
import * as workspaces from "./workspaces.js";
import * as sessions from "./sessions.js";
import { chatPersonId, excerpt } from "./profiles.js";
import * as duty from "./duty.js";
import fs from "node:fs";
import path from "node:path";

export const ROUTES = {
  "/api/health": "health",
  "/api/status": "status",
  "/api/inbox": "inbox",
  "/api/inbox/cleanup": "inboxCleanup",
  "/api/thread": "thread",
  "/api/chats": "chats",
  "/api/send": "send",
  "/api/state": "messageState",
  "/api/watch": "watch",
  "/api/unwatch": "unwatch",
  "/api/search": "search",
  "/api/search/chats": "searchChats",
  "/api/chat/timer": "chatTimer",
  "/api/chat/mode": "chatMode",
  "/api/chat/block": "chatBlock",
  "/api/poll": "pollNow",
  "/api/pause": "pause",
  "/api/doctor": "doctor",
  "/api/config": "getConfig",
  "/api/workspaces": "workspaces",
  "/api/targets": "targets",
  "/api/persons": "persons",
  "/api/chat/workspace": "chatWorkspace",
  "/api/chat/session": "chatSession",
  "/api/logs": "logs",
  "/api/digest": "digest",
  "/api/duty": "duty",
};

export const POST_ROUTES = {
  "/api/config": "setConfig",
  "/api/platforms": "setPlatform",
  "/api/targets/profile": "targetProfile",
  "/api/persons/profile": "personProfile",
  "/api/chat/session/reset": "chatSessionReset",
  "/api/chat/wake": "chatWake",
  "/api/chat/send-mode": "chatSendMode",
  "/api/duty/triage": "dutyTriage",
};

export const DELETE_ROUTES = {
  "/api/forget": "forget",
  "/api/persons": "personDelete",
};

function q1(q, key, fallback = "") {
  if (!q) return fallback;
  if (typeof q.get === "function") return q.get(key) ?? fallback;
  const v = q[key];
  return Array.isArray(v) ? (v[0] ?? fallback) : (v ?? fallback);
}

function boolValue(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return !["0", "false", "no", "off", ""].includes(String(v).trim().toLowerCase());
}

function pick(q, body, key, fallback = "") {
  const v = body?.[key];
  if (v !== undefined && v !== null) return v;
  return q1(q, key, fallback);
}

export class App {
  constructor({ state, im, poller, turns, profiles, logger = console, turnLog = null }) {
    this.state = state;
    this.im = im;
    this.poller = poller;
    this.turns = turns;
    this.profiles = profiles;
    this.logger = logger;
    this.turnLog = turnLog;
    this.startedAt = Date.now() / 1000;
  }

  hostReady() {
    return !!this.turns?.hostReady?.();
  }

  async handle(path, method = "GET", query = null, body = {}) {
    const m = String(method || "GET").toUpperCase();
    let name = null;
    if (m === "POST") name = POST_ROUTES[path] || ROUTES[path];
    else if (m === "DELETE") name = DELETE_ROUTES[path];
    else name = ROUTES[path];
    if (!name || typeof this[name] !== "function") {
      return { status: 404, body: { error: "not found", path } };
    }
    try {
      const out = await this[name](query || new URLSearchParams(), body || {});
      return { status: 200, body: out };
    } catch (e) {
      this.logger.error?.(`[im-standin] api ${path}:`, e);
      return { status: 500, body: { error: `${e?.name || "Error"}: ${e?.message || e}` } };
    }
  }

  recordUserDuty(chat, action, reason = "你在面板设置") {
    if (!chat) return;
    const d = chat.duty || (chat.duty = {});
    d.state = action === "ignore" ? "ignore" : "watch";
    d.by = "user";
    d.decided_at = Date.now() / 1000;
    d.reason = String(reason || "你在面板设置").slice(0, 160);
    d.review_at = 0;
    d.error = "";
  }

  selfId(platform) {
    return this.poller?.identity?.[platform]?.self_id ||
      this.im?.identity?.[platform]?.self_id || "";
  }

  /** 新建值守的默认发送方式；单点值存在 chats[].send_mode。 */
  defaultSendMode() {
    const v = this.state.data.config.send_mode_default;
    return SEND_MODES.includes(v) ? v : "draft";
  }

  /** 首次成为值守时把默认值固化成显式值；之后改默认不会覆盖它。 */
  applySendDefault(chat) {
    if (chat && !chat.send_mode) chat.send_mode = this.defaultSendMode();
  }

  publicChat(chat) {
    if (!chat) return null;
    const out = { ...chat };
    workspaces.decorateChat(out);
    const ti = this.poller.turnInfo(chat);
    out.timer = Number(chat.timer) || 0;
    out.wake_mode = chat.wake_mode === "all" ? "all" : "mention";
    // 该平台能不能判定「@ 我」；false 时面板不该给一个永远不会触发的「只盯 @我」。
    out.mentionable = this.poller.canMention(chat.platform);
    out.last_wake_at = Number(chat.last_wake_at) || 0;
    out.blocked = !!chat.blocked;
    out.watching = !!chat.watching;
    // 面板看的是实际生效值：未值守或老数据没有单点值时跟随新建默认。
    out.send_mode = chat.send_mode || this.defaultSendMode();
    out.pending = this.state.pendingCount(chat);
    out.turn_state = ti.state;
    out.last_ok = ti.last_ok;
    out.last_reason = ti.last_reason;
    out.last_at = ti.last_at;
    out.timed = !chat.blocked && !!chat.watching &&
      (chat.kind === "group" ? Number(chat.timer) === 1 : Number(chat.timer) !== -1);
    out.poll_at = chat.last_sync || 0;
    out.duty = chat.duty ? { ...chat.duty } : null;
    delete out.recent;
    return out;
  }

  decorateItem(m) {
    return { ...m, is_self: m.kind === "out" || (!!this.selfId(m.platform) && m.sender_id === this.selfId(m.platform)) };
  }

  chat(platform, chatId) {
    return this.state.getChat(platform, chatId);
  }

  supported(platform) {
    return SUPPORTED_PLATFORMS.includes(String(platform || ""));
  }

  unsupported(platform) {
    return { ok: false, reason: `插件壳不支持 ${platform || "该平台"}（独立 skill 形态可用）` };
  }

  async applyWorkspace(platform, chatId, raw) {
    const value = String(raw || "").trim();
    let ws = "";
    if (value) {
      ws = workspaces.normalize(value);
      if (!ws) return { ok: false, reason: "工作区不存在或不是绝对路径：" + value };
    }
    const chat = this.state.ensureChat(platform, chatId, {});
    const oldEff = workspaces.resolveForChat(chat).path || "";
    const newEff = workspaces.resolveForChat({ workspace: ws }).path || "";
    const changed = oldEff !== newEff;
    let interrupted = false;
    if (changed) {
      interrupted = this.turns.cancel(platform, chatId, "workspace_changed");
      const sid = chat.dsh_session || "";
      if (sid && !sessions.sessionInWorkspace(sid, newEff)) {
        this.state.setSession(chat, "", "workspace");
      }
    }
    chat.workspace = ws;
    this.state.save();
    const info = workspaces.resolveForChat({ workspace: ws });
    return {
      ok: true, workspace: ws, effective: newEff,
      title: info.title || "", changed, interrupted,
    };
  }

  async health() {
    return {
      ok: true, pid: process.pid, transport: "node",
      uptime: Math.floor(Date.now() / 1000 - this.startedAt),
    };
  }

  async status() {
    const st = await this.poller.status();
    st.config = publicConfig(this.state.data.config, this.hostReady());
    return st;
  }

  async inbox(q) {
    const filter = q1(q, "filter", "todo");
    const mode = q1(q, "group", "chat");
    if (["msg", "message", "0", "false"].includes(mode)) {
      const limit = Math.max(1, Math.min(Number(q1(q, "limit", 60)) || 60, 200));
      const rows = this.state.inboxRows(filter, limit).map((m) => this.decorateItem(m));
      return {
        filter, grouped: false, items: rows,
        chats: new Set(rows.map((r) => `${r.platform}:${r.chat_id}`)).size,
        total: rows.length, counts: this.state.counts(),
      };
    }
    const limit = Math.max(1, Math.min(Number(q1(q, "limit", 40)) || 40, 200));
    const groups = this.state.inboxGroups(filter, limit).map((g) => ({
      ...g, key: `${g.platform}:${g.chat_id}`,
      preview: (g.preview || []).map((m) => this.decorateItem(m)),
    }));
    return {
      filter, grouped: true, items: groups, chats: groups.length,
      total: groups.reduce((n, g) => n + (g.count || 0), 0),
      counts: this.state.counts(),
    };
  }

  async thread(q) {
    const platform = q1(q, "platform");
    const chatId = q1(q, "chat_id");
    const limit = Math.max(1, Math.min(Number(q1(q, "limit", 30)) || 30, 100));
    const fetch = ["1", "true", "yes"].includes(String(q1(q, "fetch", "0")).toLowerCase());
    if (!platform || !chatId) return { error: "platform 和 chat_id 必填" };
    const chat = this.state.getChat(platform, chatId) || {};
    const blocked = !!chat.blocked;
    const canFetch = !blocked && this.supported(platform);
    let polled = null;
    let items = [];
    let online = false;
    let onlineDone = false;
    let offline = false;
    let error = this.supported(platform) ? "" : `插件壳不支持 ${platform}（独立 skill 形态可用）`;
    let skipped = "";

    if (fetch && canFetch) {
      try {
        // 点开只读：补拉/分类，但绝不在这里起 turn；显式唤醒走 POST /api/chat/wake。
        polled = await this.poller.pollChat(platform, chatId, {
          name: chat.name, kind: chat.kind, limit, wake: false,
        });
        if (polled.fetched) {
          online = true;
          onlineDone = true;
          items = polled.items || [];
        } else if (polled.error) {
          error = polled.error;
        } else if (polled.skipped) {
          skipped = polled.skipped;
        }
      } catch (e) {
        polled = { ok: false, error: `${e?.name || "Error"}: ${e?.message || e}` };
        error = polled.error;
      }
    }

    // 冷却中直接用本地指针：不再回退 fetchThread 打第二次 CLI。
    if (!onlineDone && canFetch && !skipped) {
      const r = await this.poller.fetchThread(platform, chatId, limit);
      if (r.ok) {
        items = r.items || [];
        online = true;
        onlineDone = true;
      } else {
        offline = true;
        error = error || r.error;
      }
    }

    if (!onlineDone) {
      items = this.state.threadLocal(platform, chatId, limit).map((m) => this.decorateItem(m));
      if (!error) error = blocked ? "已屏蔽：不同步新消息" : (skipped || "在线拉取没有返回消息");
    } else {
      const local = new Map();
      for (const m of (this.state.getChat(platform, chatId)?.recent || [])) local.set(m.msg_id, m);
      const self = this.selfId(platform);
      items = items.slice().reverse().map((m) => {
        const row = local.get(m.msg_id) || {};
        return {
          ...m,
          kind: row.kind || m.kind || "",
          state: row.state || "",
          msg_type: row.msg_type || m.msg_type || "",
          app_link: row.app_link || m.app_link || "",
          media_paths: row.media_paths || [],
          is_self: !!m.is_self || (!!self && m.sender_id === self),
        };
      });
    }

    const fresh = this.state.getChat(platform, chatId) || chat;
    const ti = this.poller.turnInfo(fresh);
    const outChat = {
      ...fresh,
      turn_state: ti.state, last_ok: ti.last_ok, last_reason: ti.last_reason,
      pending: this.state.pendingCount(fresh),
    };
    workspaces.decorateChat(outChat);
    delete outChat.recent;
    if (polled) {
      const copy = { ...polled };
      delete copy.items;
      polled = copy;
    }
    return { chat: outChat, items, polled, online, offline, error };
  }

  async chats() {
    const rows = this.state.listChats().map((c) => this.publicChat(c));
    return {
      items: rows, default_workspace: workspaces.defaultPath(),
      poll: this.poller.pollInfo(),
    };
  }

  async send(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    const text = String(pick(q, body, "text") || "").trim();
    const replyTo = pick(q, body, "msg_id") || "";
    if (!platform || !chatId || !text) return { ok: false, reason: "bad_request" };
    if (!this.supported(platform)) return this.unsupported(platform);
    try {
      const r = await this.im.adapter(platform).sendText(chatId, text);
      if (!r.ok) return { ok: false, reason: r.error || "send failed" };
      if (replyTo) this.state.setMessageState(platform, replyTo, "replied", chatId);
      return { ok: true, message_id: r.message_id || "", counts: this.state.counts() };
    } catch (e) {
      return { ok: false, reason: `${e?.name || "Error"}: ${e?.message || e}` };
    }
  }

  async messageState(q, body = {}) {
    const platform = pick(q, body, "platform");
    const msgId = pick(q, body, "msg_id");
    const state = pick(q, body, "state");
    if (!platform || !msgId || !["new", "opened", "replied", "ignored"].includes(state)) {
      return { ok: false, reason: "bad_request" };
    }
    const r = this.state.setMessageState(platform, msgId, state, pick(q, body, "chat_id", ""));
    if (!r.ok) return { ok: false, reason: r.reason, counts: this.state.counts() };
    return { ok: true, counts: this.state.counts() };
  }

  /**
   * 「加入值守」= 现在就开始盯：补拉一次拿正文，再起一轮开场会话。
   * 任何失败都不影响 watching 已保存的事实，只把原因回给面板。
   */
  async openAfterJoin(chat) {
    const platform = chat.platform;
    const chatId = chat.chat_id;
    if (chat.blocked) return { ok: false, reason: "blocked" };
    if (!this.turns) return { ok: false, reason: "host_unavailable" };
    // 已被取消、正在收尾的旧轮不算在飞：重开 / 切关注程度刚 cancel 过它，
    // 这里要能继续把新会话开起来（Turns.open 内部会等旧轮收尾）。
    const busy = typeof this.turns.busy === "function"
      ? this.turns.busy(platform, chatId)
      : !!(typeof this.turns.isActive === "function" && this.turns.isActive(platform, chatId));
    if (busy) return { ok: true, skipped: "running" };
    this.applySendDefault(chat);
    try {
      await this.poller.pollChat(platform, chatId, {
        name: chat.name, kind: chat.kind, force: true, wake: false,
      });
    } catch { /* 拉不到就用本地最近消息开场 */ }
    try {
      const r = await this.turns.open(chat, { reason: "join" });
      return { ok: !!r.ok, reason: r.reason || "", skipped: r.skipped || "" };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e?.name || e).slice(0, 160) };
    }
  }

  async watch(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    if (!this.supported(platform)) return this.unsupported(platform);
    const name = pick(q, body, "name");
    const kind = pick(q, body, "kind");
    const workspace = pick(q, body, "workspace");
    this.state.ensureChat(platform, chatId, {
      name, kind, target: true,
    });
    if (workspace) {
      const applied = await this.applyWorkspace(platform, chatId, workspace);
      if (!applied.ok) return applied;
    }
    const chat = this.state.ensureChat(platform, chatId, {
      name, kind, target: true,
    });
    const rawWatching = pick(q, body, "watching", undefined);
    const watching = rawWatching === undefined || rawWatching === "" ? true : boolValue(rawWatching, true);
    const wasWatching = !!chat.watching;
    chat.watching = watching;
    chat.target = true;
    // 加入值守的默认口径：盯上就要真的拉。群只有 timer=1 才进轮询，私聊 timer=-1
    // 表示「不盯」——重新加入时必须把 -1 清掉，否则看着在盯、其实一条都不拉。
    // wake_mode 不动：沿用上次的关注程度（关闭时不改写，见 chatMode）。
    if (watching) {
      if (Number(chat.timer) !== 1) chat.timer = 1;
      if (chat.kind === "group" && chat.wake_mode !== "all") chat.wake_mode = "mention";
      this.applySendDefault(chat);
    }
    // 加入值守即视为启用该平台：钉钉默认不开，避免没装 dws 的用户每轮白跑一次 whoami。
    if (watching) {
      const enabled = this.state.data.config.platforms || [];
      if (!enabled.includes(platform)) {
        this.state.data.config.platforms =
          SUPPORTED_PLATFORMS.filter((p) => p === platform || enabled.includes(p));
      }
    }
    if (!watching) this.turns.cancel(platform, chatId, "unwatch");
    this.recordUserDuty(chat, watching ? "watch" : "ignore");
    this.state.save();
    // 重复加入（已经盯上、会话也在）不重复开场，免得多跑一轮、甚至多回一条；
    // 但会话缺了（重开过/工作区漂移/会话丢失）就补开，别留空窗。
    const open = watching && (!wasWatching || !chat.dsh_session)
      ? await this.openAfterJoin(chat)
      : null;
    // 记忆文件放在开场轮之后 ensure：开场前的 pollChat 已把最近消息并进 recent，
    // 单聊才能按发送者推出对方的人物档案（spec 0035）。
    try { this.profiles.ensureMemory(platform, chat, this.selfId(platform)); } catch { /* best effort */ }
    return { ok: true, chat: this.publicChat(chat), open };
  }

  async unwatch(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    const chat = this.state.ensureChat(platform, chatId, {});
    chat.watching = false;
    chat.timer = -1;
    this.turns.cancel(platform, chatId, "unwatch");
    this.recordUserDuty(chat, "ignore");
    this.state.save();
    return { ok: true };
  }

  async forget(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    const chat = this.state.getChat(platform, chatId);
    this.turns.cancel(platform, chatId, "forget");
    // 只删旧版会话工作本与会话状态：单聊现在只有对方的人物档案，跨会话保留；
    // 删人物走 DELETE /api/persons。
    if (chat) this.profiles.delete(platform, chatId, chat.name);
    this.state.deleteChat(platform, chatId);
    return { ok: true };
  }

  async search(q, body = {}) {
    const platform = pick(q, body, "platform");
    const term = String(pick(q, body, "q") || "").trim();
    if (!platform || !term) return { ok: false, reason: "bad_request" };
    if (!this.supported(platform)) return this.unsupported(platform);
    try {
      const r = await this.im.adapter(platform).search(term);
      return { ok: r.ok, items: r.items, error: r.ok ? "" : r.error };
    } catch (e) {
      return { ok: false, items: [], error: `${e?.name || "Error"}: ${e?.message || e}` };
    }
  }

  async searchChats(q, body = {}) {
    const platform = pick(q, body, "platform");
    const term = String(pick(q, body, "q") || "").trim();
    if (!platform || !term) return { ok: false, reason: "bad_request" };
    if (!this.supported(platform)) return this.unsupported(platform);
    try {
      const r = await this.im.adapter(platform).searchChats(term);
      return { ok: r.ok, items: r.items, error: r.ok ? "" : r.error };
    } catch (e) {
      return { ok: false, items: [], error: `${e?.name || "Error"}: ${e?.message || e}` };
    }
  }

  /**
   * 「关注程度」一档三态，一次写 watching / timer / wake_mode（off 只写前两个），
   * 面板不用再记两套开关的组合。按会话 kind 解释：
   * 群 mention=只 @ 唤醒、all=非 @ 也进批次；私聊 mention=只认 @、all=每条都唤醒。
   * 读不到 @ 信息的平台（企微）只拒绝私聊的 mention，别给一个永远不动的开关。
   * off 会取消在飞 turn，与 unwatch 一致；但 off 不动 wake_mode——下次开启沿用上次的
   * 关注程度，重新加入值守时也不会突然变成「只认 @」（spec 0027 / 0028）。
   */
  async chatMode(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    const mode = String(pick(q, body, "mode") || "");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    if (!["off", "mention", "all"].includes(mode)) {
      return { ok: false, reason: "mode 必须是 off / mention / all" };
    }
    if (!this.supported(platform)) return this.unsupported(platform);
    const chat = this.state.ensureChat(platform, chatId, {
      name: pick(q, body, "name"), kind: pick(q, body, "kind"),
    });
    if (mode === "mention" && chat.kind !== "group" && !this.poller.canMention(platform)) {
      return { ok: false, reason: "该平台私聊读不到 @ 信息，不能只认 @我" };
    }
    const on = mode !== "off";
    const wasOn = !!chat.watching;
    chat.watching = on;
    chat.timer = on ? 1 : -1;
    if (on) {
      chat.wake_mode = mode === "all" ? "all" : "mention";
      if (chat.wake_mode !== "all") chat.last_wake_at = 0;
      chat.target = true;
      this.applySendDefault(chat);
      const enabled = this.state.data.config.platforms || [];
      if (!enabled.includes(platform)) {
        this.state.data.config.platforms =
          SUPPORTED_PLATFORMS.filter((p) => p === platform || enabled.includes(p));
      }
    } else {
      this.turns.cancel(platform, chatId, "mode_off");
    }
    this.recordUserDuty(chat, on ? "watch" : "ignore");
    this.state.save();
    // 从「不盯」切回来要立刻起会话；已经在盯但绑定为空（刚重开/会话丢失）也要补上，
    // 否则 @-only 模式下会一直等不到下一轮命中，看着像没生效（spec 0028）。
    const open = on && (!wasOn || !chat.dsh_session) ? await this.openAfterJoin(chat) : null;
    // 与加入值守同一顺序：先开场（pollChat 补 recent），再按会话 kind 落记忆文件。
    if (on) {
      try { this.profiles.ensureMemory(platform, chat, this.selfId(platform)); } catch { /* best effort */ }
    }
    return { ok: true, chat: this.publicChat(chat), open, poll: this.poller.pollInfo() };
  }

  /** 值班单点发送方式：只改这一通会话，之后改全局默认也不会覆盖它。 */
  async chatSendMode(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    const mode = String(pick(q, body, "mode") || "");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    if (!SEND_MODES.includes(mode)) {
      return { ok: false, reason: "mode 必须是 draft / auto" };
    }
    if (!this.supported(platform)) return this.unsupported(platform);
    const r = this.state.setChatSendMode(platform, chatId, mode);
    if (!r.ok) return r;
    this.state.save();
    return {
      ok: true, send_mode: r.chat.send_mode,
      chat: this.publicChat(r.chat),
    };
  }

  async chatTimer(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    const timer = Number(pick(q, body, "timer"));
    if (![-1, 0, 1].includes(timer)) return { ok: false, reason: "timer 必须是 -1 / 0 / 1" };
    const chat = this.state.ensureChat(platform, chatId, {
      name: pick(q, body, "name"), kind: pick(q, body, "kind"),
    });
    chat.timer = timer;
    this.state.save();
    return { ok: true, chat: this.publicChat(chat), poll: this.poller.pollInfo() };
  }

  async chatBlock(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    const want = boolValue(pick(q, body, "blocked", undefined), true);
    const chat = this.state.ensureChat(platform, chatId, {
      name: pick(q, body, "name"), kind: pick(q, body, "kind"),
    });
    chat.blocked = want;
    chat.blocked_at = want ? Date.now() / 1000 : 0;
    let ignored = 0;
    if (want) {
      for (const m of chat.recent) {
        if (!(m.kind === "dm" || m.kind === "mention" || m.kind === "service")) continue;
        if (!(m.state === "new" || m.state === "opened")) continue;
        m.state = "ignored";
        m.content = "";
        ignored += 1;
      }
      this.turns.cancel(platform, chatId, "blocked");
    }
    if (want) this.recordUserDuty(chat, "ignore", "你在面板屏蔽");
    this.state.save();
    return {
      ok: true, blocked: want, ignored,
      chat: this.publicChat(chat), counts: this.state.counts(),
      poll: this.poller.pollInfo(),
    };
  }

  async pollNow(q, body) {
    const platform = body.platform || q1(q, "platform");
    const chatId = body.chat_id || q1(q, "chat_id");
    if (platform && chatId) {
      if (!this.supported(platform)) return this.unsupported(platform);
      const res = await this.poller.pollChat(platform, chatId, {
        name: body.name, kind: body.kind,
      });
      return { ok: !!res.fetched || !res.error, single: true, ...res };
    }
    if (this.poller.cycleLock) return { ok: false, busy: true, reason: "上一轮还没跑完" };
    void this.poller.cycle({ note: "manual" }).catch((e) => {
      this.poller.logError(null, null, "manual cycle: " + (e?.message || e));
    });
    return { ok: true, started: true };
  }

  async pause(q, body = {}) {
    this.state.data.paused = boolValue(pick(q, body, "paused", undefined), false);
    this.state.save();
    return { ok: true, paused: this.state.data.paused };
  }

  async duty(q) {
    const info = this.poller.dutyInfo();
    const items = [];
    for (const it of info.items) {
      const chat = this.state.getChat(it.platform, it.chat_id);
      if (!chat) continue;
      items.push({ ...this.publicChat(chat), duty: chat.duty ? { ...chat.duty } : null });
    }
    return { ...info, items };
  }

  async dutyTriage(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    if (!this.supported(platform)) return this.unsupported(platform);
    const chat = this.state.getChat(platform, chatId);
    if (!chat) return { ok: false, reason: "chat_not_found" };
    if (chat.kind !== "group") return { ok: false, reason: "not_group" };
    if (chat.watching) return { ok: false, reason: "already_watching" };
    if (chat.blocked) return { ok: false, reason: "blocked" };
    if (["queued", "triaging"].includes(chat.duty?.state)) {
      return { ok: false, reason: "already_queued" };
    }
    const force = boolValue(pick(q, body, "force"), false);
    if (!force && ["ignore", "failed"].includes(chat.duty?.state)) {
      return { ok: false, reason: "already_decided" };
    }
    if (!this.poller.dutyCfg().enabled && !force) {
      return { ok: false, reason: "duty_disabled" };
    }
    duty.newEvent(chat, "manual");
    this.state.save();
    return { ok: true, chat: this.publicChat(chat) };
  }

  async doctor() {
    return this.poller.doctor();
  }

  async getConfig() {
    return publicConfig(this.state.data.config, this.hostReady());
  }

  async setConfig(q, body) {
    const merged = { ...this.state.data.config, ...(body || {}) };
    for (const k of ["poll", "dsh", "duty"]) {
      if (body?.[k] && typeof body[k] === "object") {
        merged[k] = { ...(this.state.data.config[k] || {}), ...body[k] };
      }
    }
    const ignored = Array.isArray(body?.platforms)
      ? body.platforms.filter((p) => !SUPPORTED_PLATFORMS.includes(String(p)))
      : [];
    this.state.data.config = normalizeConfig(merged);
    this.state.save();
    this.poller.reload();
    const out = publicConfig(this.state.data.config, this.hostReady());
    if (ignored.length) {
      out.ignored_platforms = ignored;
      out.notice = `插件壳不支持 ${ignored.join(" / ")}（独立 skill 形态可用），已忽略`;
    }
    return out;
  }

  async setPlatform(q, body = {}) {
    const platform = String(pick(q, body, "platform") || "");
    if (!platform) return { ok: false, reason: "bad_request" };
    if (!this.supported(platform)) return this.unsupported(platform);
    const enabled = boolValue(pick(q, body, "enabled"), false);
    const cur = new Set(this.state.data.config.platforms || []);
    if (enabled) cur.add(platform); else cur.delete(platform);
    this.state.data.config.platforms = SUPPORTED_PLATFORMS.filter((p) => cur.has(p));
    this.state.save();
    this.poller.reload();
    return { ok: true, platforms: this.state.data.config.platforms };
  }

  async workspaces() {
    return { items: workspaces.listWorkspaces(), default: workspaces.defaultPath() };
  }

  /**
   * 一份人物档案出现在哪些会话里：p2p 用 chatPersonId 推（无消息时可按平台形态
   * 用 chat_id 兜底），群聊只看 recent 的 sender_id。纯读聚合，不写 state。
   */
  chatHasPerson(chat, personId) {
    const id = String(personId || "");
    if (!chat || !id) return false;
    if (chatPersonId(chat.platform, chat, this.selfId(chat.platform)) === id) return true;
    return (chat?.recent || []).some((m) => String(m?.sender_id || "") === id);
  }

  /**
   * 人物档案列表：扫 profiles/people/ 目录，只读、不 ensure、不建空档案。
   * chat_ids 是出处会话（{platform, chat_id, name}），只做反查、不落盘。
   */
  async persons(q) {
    const platform = String(q1(q, "platform") || "");
    const chats = this.state.listChats();
    const items = this.profiles.listPeople(platform).map((p) => ({
      platform: p.platform,
      person_id: p.person_id,
      name: p.name,
      profile: p.text,
      profile_excerpt: p.excerpt,
      profile_path: p.path,
      profile_updated_at: p.mtime,
      bytes: p.bytes,
      chat_ids: chats
        .filter((c) => c.platform === p.platform && this.chatHasPerson(c, p.person_id))
        .map((c) => ({ platform: c.platform, chat_id: c.chat_id, name: c.name })),
    }));
    return { ok: true, items };
  }

  /**
   * 面板覆盖写人物档案。base_mtime 是面板加载时的 mtime：磁盘比它新就回 stale，
   * 不静默覆盖 agent 刚写的内容；12KB 硬上限沿用 profiles.writePerson。
   */
  async personProfile(q, body = {}) {
    const platform = String(pick(q, body, "platform") || "");
    const personId = String(pick(q, body, "person_id") || "").trim();
    const name = String(pick(q, body, "name") || "");
    const text = pick(q, body, "text", undefined);
    if (!platform || !personId) return { ok: false, reason: "bad_request" };
    const baseMtime = Number(pick(q, body, "base_mtime", 0)) || 0;
    const r = this.profiles.writePerson(platform, personId, name, text, { baseMtime });
    if (!r.ok) return { ok: false, reason: r.reason };
    return {
      ok: true, profile: r.text, profile_path: r.path,
      profile_updated_at: r.mtime,
    };
  }

  /** 删除一份人物档案（显式操作）。删会话走 /api/forget，不会连带删人物。 */
  async personDelete(q, body = {}) {
    const platform = String(pick(q, body, "platform") || "");
    const personId = String(pick(q, body, "person_id") || "").trim();
    if (!platform || !personId) return { ok: false, reason: "bad_request" };
    return { ok: true, deleted: this.profiles.deletePerson(platform, personId) };
  }

  async targets() {
    const rows = [];
    for (const chat of this.state.listChats().filter((c) => c.target)) {
      // 记忆文件：群＝会话工作本；单聊＝对方的人物档案一份。旧私聊工作本在这里
      // 第一次被碰到时整文件搬到人物档案路径（profiles.ensureMemory）。
      const selfId = this.selfId(chat.platform);
      const memory = this.profiles.memoryFor(chat.platform, chat, selfId);
      const prof = this.profiles.ensureMemory(chat.platform, chat, selfId);
      const row = {
        platform: chat.platform,
        name: chat.name,
        chat_id: chat.chat_id,
        open_id: "",
        kind: chat.kind === "group" ? "group" : "p2p",
        profile: prof.text,
        profile_excerpt: excerpt(prof.text),
        profile_path: prof.path,
        profile_updated_at: prof.mtime,
        in_env: false,
        chat: this.publicChat(chat),
      };
      // 群不挂 person：人物评价属于人，不属于群（群详情用人物列表反查 chips）。
      // 单聊的 profile* 已经是对方人物档案，person 块给同一份，字段形状保持不变。
      if (row.kind === "p2p") {
        const personId = memory.person_id || chatPersonId(chat.platform, chat, selfId);
        if (personId) {
          const person = memory.single
            ? { path: prof.path, text: prof.text, mtime: prof.mtime, exists: true }
            : this.profiles.readPerson(chat.platform, personId);
          // 人物 ID 全被 sanitize 掉时 path 为空：不给一个点不开的人物指针。
          if (person.path) {
            row.person = {
              person_id: personId,
              path: person.path,
              excerpt: excerpt(person.text),
              updated_at: person.mtime,
              exists: memory.single ? !!person.text : !!person.exists,
            };
          }
        }
      }
      rows.push(row);
    }
    rows.sort((a, b) => {
      const aw = (a.chat?.watching ? 0 : 1) - (b.chat?.watching ? 0 : 1);
      if (aw) return aw;
      const ap = (a.profile || "").trim() ? 0 : 1;
      const bp = (b.profile || "").trim() ? 0 : 1;
      return (ap - bp) || String(a.name).localeCompare(String(b.name));
    });
    return { items: rows };
  }

  /**
   * 写会话的记忆文件：群写会话工作本，单聊写对方的人物档案（同一份，不另存）。
   * 优先按 chat_id 定位会话：同名不同会话不会串；旧面板只给 platform+name 时再按显示名找 target 兜底。
   */
  async targetProfile(q, body = {}) {
    const platform = String(pick(q, body, "platform") || "");
    const chatId = String(pick(q, body, "chat_id") || "");
    const name = String(pick(q, body, "name") || "");
    if (!platform) return { ok: false, reason: "bad_request" };
    let chat = null;
    if (chatId) {
      const found = this.state.getChat(platform, chatId);
      if (found && found.target) chat = found;
    }
    if (!chat && name) {
      chat = this.state.listChats().find(
        (c) => c.platform === platform && c.target && c.name === name,
      ) || null;
    }
    if (!chat) return { ok: false, reason: "not_found" };
    const text = pick(q, body, "text", undefined);
    const memory = this.profiles.memoryFor(platform, chat, this.selfId(platform));
    const r = memory.single
      ? this.profiles.writePerson(platform, memory.person_id, chat.name, text)
      : this.profiles.write(platform, chat.chat_id, chat.name, text);
    if (!r.ok) return { ok: false, reason: r.reason };
    return {
      ok: true, profile: r.text, profile_path: r.path,
      profile_updated_at: r.mtime,
    };
  }

  async chatWorkspace(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    const hasWs = body && ("workspace" in body || "path" in body);
    const hasQ = q && (q.has?.("workspace") || q.has?.("path"));
    if (!hasWs && !hasQ) {
      return { ok: false, reason: "bad_request: workspace/path 必填" };
    }
    const raw = body && "workspace" in body
      ? body.workspace
      : (body && "path" in body ? body.path : q1(q, q.has?.("workspace") ? "workspace" : "path", ""));
    const res = await this.applyWorkspace(platform, chatId, raw || "");
    if (!res.ok) return res;
    // 换工作区可能把旧会话解绑掉（DSH 会话按 cwd 归属）。值守中又没有会话时立刻开一个，
    // 否则又回到「等下一轮命中」——@-only 私聊会看起来像坏了（spec 0028）。
    const chat = this.state.getChat(platform, chatId);
    const open = chat && chat.watching && !chat.blocked && !chat.dsh_session
      ? await this.openAfterJoin(chat)
      : null;
    return {
      ok: true, workspace: res.workspace || "", effective: res.effective || "",
      label: res.title || "", changed: !!res.changed, open,
    };
  }

  async chatSession(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    const chat = this.state.getChat(platform, chatId) || {};
    const ws = workspaces.resolveForChat(chat);
    const sid = chat.dsh_session || "";
    const file = sid ? sessions.sessionFile(sid, ws.path || "") : "";
    return {
      ok: true, session_id: sid, workspace: ws, session_path: file,
      dsh: publicConfig(this.state.data.config, this.hostReady()).resolved,
    };
  }

  async chatSessionReset(q, body) {
    const platform = body.platform;
    const chatId = body.chat_id;
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    const old = (this.state.getChat(platform, chatId) || {}).dsh_session || "";
    let interrupted = false;
    if (body.workspace) {
      const applied = await this.applyWorkspace(platform, chatId, body.workspace);
      if (!applied.ok) return applied;
      interrupted = interrupted || !!applied.interrupted;
    }
    interrupted = this.turns.cancel(platform, chatId, "session_reset") || interrupted;
    const chat = this.state.ensureChat(platform, chatId, {});
    this.state.setSession(chat, "", "manual");
    // 旧轮可能留下「进行中 / 失败」的痕迹，手动重开是干净的起点。
    chat.wake.active = false;
    chat.wake.failed = false;
    chat.wake.turn_id = "";
    this.state.save();
    // 只解绑会让 @-only 私聊长期没有会话可续（下一轮命中可能不来）；立刻在新会话里开场。
    // 刚被 cancel 的旧轮不算在飞（Turns.busy），所以这里不会误判成 running。
    // 未值守 / 屏蔽 / 宿主未就绪不强行开，只回报原因，解绑结果不受影响（spec 0028）。
    const open = (chat.watching && !chat.blocked) ? await this.openAfterJoin(chat) : null;
    return { ok: true, previous: old, interrupted, open, chat: this.publicChat(chat) };
  }

  async chatWake(q, body) {
    const platform = body.platform;
    const chatId = body.chat_id;
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    if (!this.supported(platform)) return this.unsupported(platform);
    if (body.workspace) {
      const applied = await this.applyWorkspace(platform, chatId, body.workspace);
      if (!applied.ok) return applied;
    }
    const chat = this.state.getChat(platform, chatId);
    if (!chat) return { ok: false, reason: "chat_not_found" };
    if (chat.blocked) return { ok: false, reason: "blocked" };
    if (!chat.watching) return { ok: false, reason: "not_watching" };
    if (this.turns.busy?.(platform, chatId)) {
      return { ok: false, reason: "running", pending: this.state.pendingCount(chat) };
    }
    const nonSelf = chat.recent.some((m) => m.kind !== "out");
    if (!nonSelf) return { ok: false, reason: "empty", pending: 0 };
    const pending = this.state.pendingCount(chat);
    if (!pending) return { ok: false, reason: "no_pending", pending: 0 };
    const r = await this.turns.wake(chat, {});
    if (!r.ok) return { ok: false, reason: r.reason, pending };
    return { ok: true, pending, state: "running", turn_id: r.turn_id };
  }

  async inboxCleanup() {
    const ignored = this.state.ignoreUnwatched();
    this.state.save();
    return { ok: true, ignored, counts: this.state.counts() };
  }

  async logs() {
    return {
      sends: [], errors: this.poller.errors.slice(0, 20),
      turns: this.turns.snapshot(),
      events: this.turnLog?.recent?.(80) || [],
    };
  }

  /**
   * 每日关注摘要：只读 agent 写的那份文件，不创建、不解析、不统计。
   * 目录与文件名都是确定性约定，插件这边唯一要防的是路径穿越。
   */
  async digest(q) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-` +
      String(now.getDate()).padStart(2, "0");
    const date = String(q1(q, "date", "") || today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: "bad_date" };
    const [y, mo, da] = date.split("-").map(Number);
    const probe = new Date(y, mo - 1, da);
    if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== da) {
      return { ok: false, reason: "bad_date" };
    }
    const dir = path.resolve(this.state.dir, "digest");
    const file = path.resolve(dir, `${date}.md`);
    if (!file.startsWith(dir + path.sep)) return { ok: false, reason: "bad_date" };
    let text = "";
    let mtime = 0;
    try {
      const st = fs.statSync(file);
      if (st.isFile()) {
        mtime = Math.floor(st.mtimeMs / 1000);
        text = fs.readFileSync(file, "utf8");
        if (text.length > 256 * 1024) text = text.slice(0, 256 * 1024) + "\n\n（过长，已截断）";
      }
    } catch { /* 文件不存在就是空态，不建目录、不写盘 */ }
    return { ok: true, date, exists: !!mtime, text, mtime };
  }
}
