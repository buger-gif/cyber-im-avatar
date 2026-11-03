/**
 * turns.js — 把唤醒 prompt 送进绑定的 DSH live 会话，等这一轮结束。
 *
 * 没有 headless 子进程：sessionController.resolveAgent() 拿到的就是 DSH 里
 * 同一个 agent；UI 打开它不会再抢 session.lock。一个宿主进程内按 chat 串行；
 * 新消息到达时先取消旧 turn，再在同一 session 里跑新的。
 */
import crypto from "node:crypto";
import fs from "node:fs";

import { chatKey } from "./state.js";
import * as workspaces from "./workspaces.js";
import { MAX_PROFILE, SOFT_PROFILE, profileNeedsCompact } from "./profiles.js";

const PROFILE_RE = /<!--\s*im-profile-update\s*\r?\n([\s\S]*?)\r?\n\s*-->/g;
const PLAT_LABEL = { feishu: "飞书", wecom: "企业微信", dingtalk: "钉钉" };

function nowSec() {
  return Date.now() / 1000;
}

function makeUserMessage(text) {
  return Object.freeze({
    id: crypto.randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "user" },
  });
}

function textOfContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (c && c.type === "text" ? String(c.text || "") : "")).join("");
}

function formatMsgLine(m) {
  let text = String(m.content || "").replace(/\s+/g, " ").trim();
  if (!text) text = "（正文在线查）";
  if (text.length > 800) text = text.slice(0, 800) + "…";
  const tag = m.kind === "out" ? "我" : (m.sender_name || "对方");
  return `- [${m.ts || ""}] ${tag}: ${text}`;
}

export function buildPrompt(platform, chatName, chatId, recent, {
  profilePath = "", profileText = "", interrupted = false,
} = {}) {
  const label = PLAT_LABEL[platform] || platform;
  const parts = ["/cyber-im-avatar"];
  if (interrupted) {
    parts.push("（上一轮被新消息打断，以最新上下文为准；未完成的事重新判断。）");
  }
  parts.push("");
  parts.push(`值守命中 · ${label} · ${chatName || chatId}`);
  parts.push(`chat_id：${chatId}`);
  parts.push("运行形态：DSH 插件壳（宿主内会话）。不要运行 listen_cli/bootstrap.py，不要写 ~/.im-standin。");
  if (profilePath) parts.push(`画像文件：${profilePath}`);
  if (String(profileText || "").trim()) {
    let text = String(profileText).trim();
    const compact = profileNeedsCompact(text);
    if (compact.needed) {
      const detail = compact.reason === "size"
        ? `画像 ${(compact.bytes / 1024).toFixed(1)}KB`
        : `历史结论 ${compact.bullets} 条（日期流水 ${compact.dated} 条）`;
      parts.push(`（${detail}，需要整理：保留四段结构，合并重复，删除一次性/已失效，` +
        "把按日期的流水改写成结论，历史结论控制在 20 条内；先整理到 8KB 以下，" +
        "仍超 12KB 会被拒写。）");
    }
    parts.push("当前画像：");
    parts.push(text);
  }
  parts.push("最近 10 条（本地只留指针，完整上下文在线查）：");
  for (const m of recent.slice().sort((a, b) => (a.ts_epoch - b.ts_epoch))) {
    parts.push(formatMsgLine(m));
  }
  parts.push("");
  parts.push("按 skill 处理这通会话。监听、水位、唤醒由插件负责，不要挂监听。");
  const needAttach = profileNeedsCompact(profileText).needed;
  parts.push(needAttach
    ? "画像更新：当前画像需要整理；本轮即使没有新事实，也要在最终回复末尾附整理后的完整画像，格式："
    : "画像更新：本轮若学到长期有效的新事实，在最终回复末尾附一个完整的新画像 Markdown，格式：");
  parts.push("<!-- im-profile-update\n<完整画像>\n-->");
  parts.push(needAttach
    ? "只写结论，不写聊天原文、其他会话的事实或凭据。"
    : "没有新事实就不要附；不要写聊天原文、其他会话的事实或凭据。");
  parts.push("画像维护：历史结论只放仍然有效的结论，不按日期记流水；同一事实合并/覆盖，" +
    "旧结论被推翻就改原句；历史结论控制在 20 条内。");
  return parts.join("\n");
}

/**
 * 同一会话的后续唤醒：只追加这次触发的新消息。
 * skill 入口、画像正文、最近 10 条与完整监听说明已在首轮载荷里，不重复；
 * 只留一行运行形态，避免会话被压缩后误挂监听。
 */
export function buildDeltaPrompt(platform, chatName, chatId, messages, {
  interrupted = false, profileNote = "",
} = {}) {
  const label = PLAT_LABEL[platform] || platform;
  const parts = [];
  if (interrupted) {
    parts.push("（上一轮被新消息打断，以最新上下文为准；未完成的事重新判断。）");
  }
  parts.push(`值守命中 · ${label} · ${chatName || chatId} · 新消息`);
  parts.push(`chat_id：${chatId}`);
  parts.push("运行形态：DSH 插件壳；不要挂监听，不要写 ~/.im-standin。");
  if (profileNote) parts.push(profileNote);
  for (const m of messages.slice().sort((a, b) => (a.ts_epoch - b.ts_epoch))) {
    parts.push(formatMsgLine(m));
  }
  return parts.join("\n");
}

export class Turns {
  constructor({ state, profiles, poller = null, logger = console }) {
    this.state = state;
    this.profiles = profiles;
    this.poller = poller;
    this.logger = logger;
    this.sessionController = null;
    this.sessions = null;
    this.registry = null;
    this.ctx = null;
    this.active = new Map();
    this.starting = new Map();
  }

  setHost(hostCtx, rootCtx = null) {
    this.sessionController = hostCtx.sessionController || hostCtx.get?.("sessionController") || null;
    this.sessions = hostCtx.sessions || hostCtx.get?.("sessions") || null;
    this.ctx = rootCtx || hostCtx;
  }

  setRegistry(registry) {
    this.registry = registry;
  }

  hostReady() {
    return !!(this.sessionController && this.sessions && this.ctx);
  }

  snapshot() {
    const out = {};
    for (const [key, h] of this.active) {
      out[key] = {
        state: h.state || "running", since: h.since || 0, started_at: h.startedAt || 0,
        last_ok: h.lastOk ?? null, last_reason: h.lastReason || "",
        last_at: h.lastAt || 0, turn_id: h.turnId || "", interrupted: !!h.interrupted,
      };
    }
    return out;
  }

  isActive(platform, chatId) {
    return this.active.has(chatKey(platform, chatId));
  }

  async wake(chat, { interrupted = false, retry = false, postTurn = false, batch = null } = {}) {
    if (!this.hostReady()) {
      return { ok: false, reason: "host_unavailable" };
    }
    const key = chatKey(chat.platform, chat.chat_id);
    // 新消息到了：先立刻打断在飞 turn，别等它跑完再排队。
    const old = this.active.get(key);
    if (old) {
      old.cancelled = true;
      if (old.cancel) old.cancel();
      else this.cancelHandle(old);
    }
    // 只串行化“启动”这一步，避免同一会话同时 resolve/create 两个 session；
    // turn 本身不排队（上面的 cancel 就是为了不排队）。
    const starting = this.starting.get(key);
    if (starting) {
      try { await starting; } catch { /* 上一次启动失败也继续 */ }
    }
    const run = this._wake(chat, { interrupted, retry, postTurn, batch });
    this.starting.set(key, run);
    try {
      return await run;
    } finally {
      if (this.starting.get(key) === run) this.starting.delete(key);
    }
  }

  async _wake(chat, { interrupted = false, batch = null } = {}) {
    const key = chatKey(chat.platform, chat.chat_id);
    const current = this.state.getChat(chat.platform, chat.chat_id) || chat;
    if (!current.watching || current.blocked) {
      return { ok: false, reason: "not_watching" };
    }
    const old = this.active.get(key);
    if (old) {
      old.cancelled = true;
      if (old.cancel) old.cancel();
      else this.cancelHandle(old);
      try { await old.done; } catch { /* old turn already gone */ }
    }
    const turnId = crypto.randomUUID();
    const handle = {
      turnId, platform: chat.platform, chatId: chat.chat_id,
      cancelled: false, state: "running", since: nowSec(), startedAt: nowSec(),
      lastOk: null, lastReason: "", lastAt: 0, promptId: "", agent: null, done: null,
    };
    current.wake = {
      at: nowSec(), failed: false, turn_id: turnId, active: true,
    };
    current.last_error = "";
    this.state.save();

    try {
      const session = await this.resolveSession(current);
      // resolveSession 可能等了很久：期间用户可能已移出值守/屏蔽/删除会话。
      if (this.state.getChat(chat.platform, chat.chat_id) !== current ||
          !current.watching || current.blocked) {
        current.wake.active = false;
        current.wake.failed = false;
        current.wake.turn_id = "";
        this.state.save();
        return { ok: false, reason: "not_watching" };
      }
      const sid = session.sessionId;
      const agent = session.agent;
      handle.agent = agent;
      this.state.setSession(current, sid);
      this.state.save();

      const prof = this.profiles.read(current.platform, current.chat_id, current.name);
      // 同一 session 已经吃过完整载荷：后续只追加新消息。skill 入口、画像和
      // 最近 10 条都在会话历史里，不重复注入。
      const delta = current.prompt_session === sid
        ? this.deltaMessages(current, batch) : [];
      const prompt = delta.length
        ? buildDeltaPrompt(current.platform, current.name, current.chat_id, delta, {
          interrupted, profileNote: this.profileNote(prof),
        })
        : buildPrompt(current.platform, current.name, current.chat_id, current.recent, {
          profilePath: prof.path, profileText: prof.text, interrupted,
        });
      const effective = session.cwd || "";
      this.active.set(key, handle);
      handle.done = this.runTurn(handle, {
        chat: current, agent, sid, cwd: effective, prompt,
        profile: { path: prof.path, mtime: prof.mtime, name: current.name },
      });
      this.state.save();
      return { ok: true, started: true, turn_id: turnId, state: "running" };
    } catch (e) {
      const reason = typeof e === "string" ? e : (e?.message || e?.name || "wake_failed");
      this.active.delete(key);
      current.wake.active = false;
      current.wake.failed = true;
      current.wake.turn_id = "";
      current.last_turn = { ok: false, reason, at: nowSec() };
      current.last_error = reason;
      this.state.save();
      this.logger.warn?.(`[im-standin] wake ${key}: ${reason}`);
      return { ok: false, reason };
    }
  }

  deltaMessages(chat, batch) {
    const seen = new Set();
    const out = [];
    const add = (m) => {
      const id = String(m?.msg_id || "");
      if (!id || seen.has(id) || !String(m?.content || "").trim()) return;
      seen.add(id);
      out.push(m);
    };
    if (Array.isArray(batch) && batch.length) {
      for (const m of batch) add(m);
    } else {
      for (const m of this.state.pendingMessages(chat)) add(m);
    }
    return out.sort((a, b) => (Number(a.ts_epoch) || 0) - (Number(b.ts_epoch) || 0));
  }

  profileNote(prof) {
    const compact = profileNeedsCompact(prof?.text);
    if (!compact.needed) return "";
    const detail = compact.reason === "size"
      ? `${(compact.bytes / 1024).toFixed(1)}KB`
      : `历史结论 ${compact.bullets} 条（日期流水 ${compact.dated} 条）`;
    return `（画像 ${detail}，需要整理；回写前按 skill「服务对象画像」整理到 8KB 以下、` +
      "历史结论 ≤20 条）";
  }

  async agentFromCreated(created) {
    // sessionController.create() 公开面返回 {sessionId}，不直接给 agent；
    // 内部 commands.create 才返回 agent。统一再 resolve 一次拿 live agent。
    const sid = String(created?.sessionId || created?.agent?.id || created?.agent?.session?.id || "");
    let agent = created?.agent || null;
    if (!agent && sid) {
      const resolved = await this.sessionController.resolveAgent(sid);
      if (resolved?.error) {
        throw new Error(resolved.error.message || resolved.error.code || "session_resolve_failed");
      }
      agent = resolved?.agent || null;
    }
    if (!agent) throw new Error("create_failed: sessionController 没有返回 agent");
    return { agent, sessionId: sid || agent.id || agent.session?.id || "" };
  }

  async resolveSession(chat) {
    const raw = String(chat.workspace || "").trim();
    let effective = "";
    let entity = null;
    if (raw) {
      effective = workspaces.normalize(raw);
      if (!effective) {
        throw new Error(`workspace_missing: 工作区不存在：${raw}`);
      }
      try { entity = await this.registry?.resolveByPath(effective); } catch { entity = null; }
      // 目录存在但 DSH 没登记：仍然可以跑（create 用 cwd），但不能因此
      // 丢掉已有的 dsh_session —— 先按下面的正常流程尝试恢复。
    } else {
      const def = workspaces.defaultPath();
      if (def) {
        effective = def;
        try { entity = await this.registry?.resolveByPath(def); } catch { entity = null; }
      }
    }

    let sid = String(chat.dsh_session || "");
    let agent = null;
    if (sid) {
      let resolved;
      try {
        resolved = await this.sessionController.resolveAgent(sid);
      } catch (e) {
        const code = e?.code || "";
        if (code === "session/not-found") resolved = null;
        else if (code === "session/writer-held") throw new Error("session_locked_other_host");
        else throw new Error(`${e?.name || "Error"}: ${e?.message || e}`);
      }
      if (resolved && resolved.error) {
        const code = resolved.error.code || "";
        if (code === "session/not-found") {
          sid = "";
        } else if (code === "session/writer-held") {
          throw new Error("session_locked_other_host");
        } else {
          throw new Error(resolved.error.message || code || "session_resolve_failed");
        }
      } else if (resolved?.agent) {
        agent = resolved.agent;
      }
      if (agent && effective) {
        const cwd = agent.session?.header?.cwd || agent.session?.cwd || agent.cwd || "";
        const norm = cwd ? workspaces.normalize(cwd) : "";
        if (norm && norm !== effective) {
          // 绑定工作区变过：旧 session 在别的 cwd，丢掉绑定，按新工作区开新会话。
          agent = null;
          sid = "";
        }
      }
    }

    if (!agent) {
      const req = entity ? { workspaceId: entity.id } : (effective ? { cwd: effective } : {});
      const made = await this.agentFromCreated(await this.sessionController.create(req));
      agent = made.agent;
      sid = made.sessionId;
    }
    if (entity && sid && Array.isArray(entity.sessionIds) && !entity.sessionIds.includes(sid)) {
      try { await entity.attachSession(sid); } catch { /* cwd mismatch or already gone */ }
    }
    return { agent, sessionId: sid, cwd: effective };
  }

  runTurn(handle, { chat, agent, sid, cwd, prompt, profile }) {
    return new Promise((resolve) => {
      const key = chatKey(chat.platform, chat.chat_id);
      const timeoutSec = Math.max(30, Number(this.state.data.config?.dsh?.timeout) || 600);
      const startedAt = Date.now();
      let promptSeen = false;
      let lastTurnStart = null;
      let turnStarted = false;
      let turnNumber = null;
      const texts = [];
      let settled = false;
      let timer = null;
      let stop = () => {};

      const settle = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try { stop(); } catch { /* listener already gone */ }
        resolve(result);
      };

      const finish = (result) => {
        if (handle.cancelled && !handle.timedOut) {
          const wasActive = this.active.get(key)?.turnId === handle.turnId;
          if (wasActive) {
            this.active.delete(key);
            chat.wake.active = false;
            chat.wake.failed = false;
            chat.wake.turn_id = "";
            this.state.save();
          }
          settle({ ok: false, reason: "cancelled" });
          return;
        }
        if (this.active.get(key)?.turnId !== handle.turnId) {
          settle(result);
          return;
        }
        this.active.delete(key);
        if (result.ok) {
          // turn 成功说明 prompt 已被消费；事件漏掉时也补一次。
          if (chat.prompt_session !== sid) {
            chat.prompt_session = sid;
          }
          try { this.applyProfile(chat, result.text, profile); }
          catch (e) { this.logger.warn?.(`[im-standin] profile write failed: ${e?.message || e}`); }
          this.state.bumpTurn(chat, true);
          handle.lastOk = true;
          handle.lastReason = "";
          handle.lastAt = nowSec();
          // 跑完立刻补拉一次：把 agent 自己发出的消息收回来，pending 才能闭合。
          setTimeout(() => {
            this.poller?.pollChat(chat.platform, chat.chat_id, { force: true, postTurn: true })
              .catch((e) => this.logger.warn?.(`[im-standin] post-turn poll: ${e?.message || e}`));
          }, 1500).unref?.();
        } else {
          const reason = result.reason || "turn_failed";
          this.state.bumpTurn(chat, false, reason);
          handle.lastOk = false;
          handle.lastReason = reason;
          handle.lastAt = nowSec();
          this.logger.warn?.(`[im-standin] turn ${key}: ${reason}`);
        }
        settle(result);
      };

      const cancel = () => {
        if (settled) return;
        handle.cancelled = true;
        this.cancelHandle(handle);
        finish({ ok: false, reason: "cancelled" });
      };
      handle.cancel = cancel;

      const collect = (event) => {
        const type = event?.type;
        if (type === "user/message") {
          if (event?.data?.id && event.data.id === handle.promptId) {
            promptSeen = true;
            handle.promptSeen = true;
            // 这一轮的载荷已经进 agent 的上下文：之后只追加新消息。
            if (chat.prompt_session !== sid) {
              chat.prompt_session = sid;
              this.state.save();
            }
            // DSH 在轮次边界先发 turn/start，再提交 user/message。
            if (!turnStarted && lastTurnStart != null) {
              turnStarted = true;
              turnNumber = lastTurnStart;
            }
          }
          return;
        }
        if (type === "turn/start") {
          lastTurnStart = event.data?.turn ?? null;
          if (promptSeen && !turnStarted) {
            turnStarted = true;
            turnNumber = lastTurnStart;
          }
          return;
        }
        if (type === "assistant/message") {
          if (!turnStarted) return;
          if (turnNumber != null && event.data?.turn !== undefined && event.data.turn !== turnNumber) return;
          texts.push(textOfContent(event.data?.message?.content ?? event.data?.content));
          return;
        }
        if (type === "turn/end") {
          if (!turnStarted || event.data?.turn !== turnNumber) return;
          const reason = event.data?.reason || { kind: "completed" };
          const kind = reason.kind || "completed";
          const text = texts.join("\n").trim();
          if (kind === "completed") {
            finish({ ok: true, reason: "", text, session_id: sid, cwd, ms: Date.now() - startedAt });
          } else if (kind === "error") {
            const error = reason.error?.message || reason.error?.code || "error";
            finish({ ok: false, reason: `error: ${error}`, text, session_id: sid, cwd, ms: Date.now() - startedAt });
          } else {
            finish({ ok: false, reason: kind, text, session_id: sid, cwd, ms: Date.now() - startedAt });
          }
        }
      };

      try {
        stop = this.ctx.on("session/event", (session, event) => {
          if (agent.session && session !== agent.session && session?.id !== agent.session?.id) return;
          collect(event);
        });
      } catch (e) {
        finish({ ok: false, reason: `listener_failed: ${e?.message || e}` });
        return;
      }

      if (handle.cancelled) {
        finish({ ok: false, reason: "cancelled" });
        return;
      }
      const message = makeUserMessage(prompt);
      handle.promptId = message.id;
      try {
        agent.followup(message);
      } catch (e) {
        finish({ ok: false, reason: `followup_failed: ${e?.message || e}` });
        return;
      }
      timer = setTimeout(() => {
        if (settled) return;
        handle.cancelled = true;
        handle.timedOut = true;
        this.cancelHandle(handle);
        finish({ ok: false, reason: "timeout", session_id: sid, cwd, ms: Date.now() - startedAt });
      }, timeoutSec * 1000);
      timer.unref?.();

      (async () => {
        try {
          const flushed = await this.sessions.flush(agent.session);
          if (flushed === false) {
            finish({ ok: false, reason: "flush_failed" });
          }
        } catch (e) {
          finish({ ok: false, reason: `flush_failed: ${e?.message || e}` });
        }
      })();
    });
  }

  cancelHandle(handle) {
    if (!handle) return;
    if (handle.promptId && handle.agent?.inbox?.remove) {
      try { handle.agent.inbox.remove(handle.promptId); } catch { /* already consumed */ }
    }
    try {
      handle.agent?.cancel?.({ kind: "user" }, { keepInbox: true });
    } catch { /* best effort */ }
  }

  applyProfile(chat, text, profile) {
    const hits = [...String(text || "").matchAll(PROFILE_RE)];
    if (!hits.length) return;
    const body = (hits[hits.length - 1][1] || "").trim();
    if (!body) return;
    const newBytes = Buffer.byteLength(body, "utf8");
    if (newBytes > MAX_PROFILE) {
      this.logger.warn?.(`[im-standin] profile ${chat.platform}:${chat.chat_id}: 超过 12KB，未写入（请先整理）`);
      return;
    }
    const current = this.profiles.read(chat.platform, chat.chat_id, chat.name);
    const oldBytes = Buffer.byteLength(current.text || "", "utf8");
    const res = this.profiles.write(chat.platform, chat.chat_id, chat.name, body, profile?.mtime || 0);
    if (!res.ok) {
      this.logger.warn?.(`[im-standin] profile ${chat.platform}:${chat.chat_id}: ${res.reason}`);
      return;
    }
    if (current.path && oldBytes > SOFT_PROFILE && newBytes < oldBytes) {
      try {
        const dest = this.profiles.archive(current.path, current.text);
        if (dest) this.logger.info?.(`[im-standin] profile archived -> ${dest}`);
      } catch (e) {
        this.logger.warn?.(`[im-standin] profile archive failed: ${e?.message || e}`);
      }
    }
  }

  cancel(platform, chatId, reason = "cancelled") {
    const key = chatKey(platform, chatId);
    const handle = this.active.get(key);
    if (!handle) return false;
    handle.cancelled = true;
    this.cancelHandle(handle);
    if (handle.cancel) handle.cancel();
    else {
      this.active.delete(key);
      const chat = this.state.getChat(platform, chatId);
      if (chat) {
        chat.wake.active = false;
        chat.wake.failed = false;
        chat.wake.turn_id = "";
        this.state.save();
      }
    }
    this.logger.info?.(`[im-standin] cancel ${key}: ${reason}`);
    return true;
  }

  stopAll() {
    for (const handle of this.active.values()) {
      handle.cancelled = true;
      this.cancelHandle(handle);
      if (handle.cancel) handle.cancel();
    }
    this.active.clear();
    this.state.save();
  }
}
