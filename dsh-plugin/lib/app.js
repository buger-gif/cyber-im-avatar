/**
 * app.js — 面板 API（与 web/panel.js 的现有契约保持一致）。
 *
 * 这里不再有 Python 进程/SQLite；所有读写在 state.json + profiles/*.md，
 * 在线正文走平台 CLI。
 */
import { publicConfig, normalizeConfig, SUPPORTED_PLATFORMS } from "./state.js";
import { isMention } from "./im.js";
import * as workspaces from "./workspaces.js";
import * as sessions from "./sessions.js";
import { excerpt } from "./profiles.js";
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
  "/api/chat/block": "chatBlock",
  "/api/poll": "pollNow",
  "/api/pause": "pause",
  "/api/doctor": "doctor",
  "/api/config": "getConfig",
  "/api/workspaces": "workspaces",
  "/api/targets": "targets",
  "/api/chat/workspace": "chatWorkspace",
  "/api/chat/session": "chatSession",
  "/api/logs": "logs",
  "/api/digest": "digest",
};

export const POST_ROUTES = {
  "/api/config": "setConfig",
  "/api/targets/profile": "targetProfile",
  "/api/chat/session/reset": "chatSessionReset",
  "/api/chat/wake": "chatWake",
};

export const DELETE_ROUTES = {
  "/api/forget": "forget",
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
  constructor({ state, im, poller, turns, profiles, logger = console }) {
    this.state = state;
    this.im = im;
    this.poller = poller;
    this.turns = turns;
    this.profiles = profiles;
    this.logger = logger;
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

  selfId(platform) {
    return this.poller?.identity?.[platform]?.self_id || "";
  }

  publicChat(chat) {
    if (!chat) return null;
    const out = { ...chat };
    workspaces.decorateChat(out);
    const ti = this.poller.turnInfo(chat);
    out.timer = Number(chat.timer) || 0;
    out.blocked = !!chat.blocked;
    out.watching = !!chat.watching;
    out.pending = this.state.pendingCount(chat);
    out.turn_state = ti.state;
    out.last_ok = ti.last_ok;
    out.last_reason = ti.last_reason;
    out.last_at = ti.last_at;
    out.timed = !chat.blocked && !!chat.watching &&
      (chat.kind === "group" ? Number(chat.timer) === 1 : Number(chat.timer) !== -1);
    out.poll_at = chat.last_sync || 0;
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
        this.state.setSession(chat, "");
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
    chat.watching = watching;
    chat.target = true;
    if (!watching) this.turns.cancel(platform, chatId, "unwatch");
    try { this.profiles.ensure(platform, chatId, chat.name); } catch { /* profile is best effort */ }
    this.state.save();
    return { ok: true, chat: this.publicChat(chat) };
  }

  async unwatch(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    const chat = this.state.ensureChat(platform, chatId, {});
    chat.watching = false;
    this.turns.cancel(platform, chatId, "unwatch");
    this.state.save();
    return { ok: true };
  }

  async forget(q, body = {}) {
    const platform = pick(q, body, "platform");
    const chatId = pick(q, body, "chat_id");
    if (!platform || !chatId) return { ok: false, reason: "bad_request" };
    const chat = this.state.getChat(platform, chatId);
    this.turns.cancel(platform, chatId, "forget");
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

  async doctor() {
    return this.poller.doctor();
  }

  async getConfig() {
    return publicConfig(this.state.data.config, this.hostReady());
  }

  async setConfig(q, body) {
    const merged = { ...this.state.data.config, ...(body || {}) };
    for (const k of ["poll", "dsh"]) {
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

  async workspaces() {
    return { items: workspaces.listWorkspaces(), default: workspaces.defaultPath() };
  }

  async targets() {
    const rows = [];
    for (const chat of this.state.listChats().filter((c) => c.target)) {
      const prof = this.profiles.ensure(chat.platform, chat.chat_id, chat.name);
      rows.push({
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
      });
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

  async targetProfile(q, body) {
    const platform = body.platform;
    const name = body.name;
    if (!platform || !name) return { ok: false, reason: "bad_request" };
    const chat = this.state.listChats().find((c) => c.platform === platform && c.target && c.name === name);
    if (!chat) return { ok: false, reason: "not_found" };
    const r = this.profiles.write(platform, chat.chat_id, chat.name, body.text);
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
    return {
      ok: true, workspace: res.workspace || "", effective: res.effective || "",
      label: res.title || "", changed: !!res.changed,
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
    this.state.setSession(chat, "");
    this.state.save();
    return { ok: true, previous: old, interrupted, chat: this.publicChat(chat) };
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
    if (this.turns.isActive(platform, chatId)) {
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
