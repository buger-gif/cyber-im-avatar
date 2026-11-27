/**
 * turns.js — 把唤醒 prompt 送进绑定的 DSH live 会话，等这一轮结束。
 *
 * 编排层：resolve 会话、打断在飞 turn、followup、看门狗、日志与状态回写；
 * 载荷拼装在 `prompt.js`，这里不拼文案。
 * 没有 headless 子进程：sessionController.resolveAgent() 拿到的就是 DSH 里
 * 同一个 agent；UI 打开它不会再抢 session.lock。一个宿主进程内按 chat 串行；
 * 新消息到达时先取消旧 turn，再在同一 session 里跑新的。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { chatKey, RECENT_LIMIT } from "./state.js";
import { ACK_EMOJI, MEDIA_ADAPTERS, imageMediaType } from "./im.js";
import { chatPersonId, personRefs } from "./profiles.js";
import { ProgressCards } from "./progress.js";
import {
  buildDeskPrompt, buildOpenPrompt, buildWakePrompt, buildWarmPrompt,
  mentionFactLine, mentionedTargets, oneLine, sanitizeUntrusted, selfLine,
  silentNoMention,
} from "./prompt.js";
import * as duty from "./duty.js";
import * as workspaces from "./workspaces.js";

export {
  buildDeskPrompt, buildOpenPrompt, buildWakePrompt, buildWarmPrompt,
  mentionFactLine, mentionedTargets, oneLine, sanitizeUntrusted, selfLine,
  silentNoMention,
};

function nowSec() {
  return Date.now() / 1000;
}

/** 取 assistant 消息里的 text 块；只认正文，不读 reasoning / tool 参数。 */
function assistantText(data) {
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

async function makeUserMessage(text, extraParts = []) {
  return Object.freeze({
    id: crypto.randomUUID(),
    role: "user",
    content: [{ type: "text", text }, ...extraParts],
    source: { kind: "user" },
  });
}

/**
 * 单轮看门狗：停滞超时为主、总时长上限兜底（spec 0034）。
 *
 * · start()：启动停滞计时；capSec > 0 时另起一枚从本轮开始算的总上限计时。
 * · touch()：每收到一条该会话的 session/event 调一次，只重置停滞计时——有工具产出 /
 *   模型输出就不算卡死；长任务不会再被「单轮只能跑 N 秒」的墙钟切掉。
 * · 先到先触发一次：停滞 → onTimeout("timeout")，总上限 → onTimeout("turn_cap")。
 * · stop()：本轮收口时清掉两枚计时器；触发后也不会再触发。
 */
export function turnWatchdog({ stallSec, capSec = 0, onTimeout }) {
  const ms = (sec) => Math.max(1, Math.round(Number(sec) * 1000));
  let stall = null;
  let cap = null;
  let done = false;
  const clear = () => {
    if (stall) clearTimeout(stall);
    if (cap) clearTimeout(cap);
    stall = null;
    cap = null;
  };
  const fire = (reason) => {
    if (done) return;
    done = true;
    clear();
    onTimeout(reason);
  };
  const armStall = () => {
    if (stall) clearTimeout(stall);
    stall = setTimeout(() => fire("timeout"), ms(stallSec));
    stall.unref?.();
  };
  return {
    start() {
      if (Number(capSec) > 0) {
        cap = setTimeout(() => fire("turn_cap"), ms(capSec));
        cap.unref?.();
      }
      armStall();
    },
    touch() {
      if (!done) armStall();
    },
    stop() {
      done = true;
      clear();
    },
  };
}

export class Turns {
  constructor({ state, profiles, poller = null, im = null, media = null, logger = console, turnLog = null }) {
    this.state = state;
    this.turnLog = turnLog;
    this.profiles = profiles;
    this.poller = poller;
    this.im = im;
    this.media = media;
    this.logger = logger;
    this.progressCards = new ProgressCards({ state, im, logger });
    this.sessionController = null;
    this.sessions = null;
    this.registry = null;
    this.attachments = null;
    this.llm = null;
    this.permissionPresets = null;
    this.ctx = null;
    this.active = new Map();
    this.starting = new Map();
    this.warming = new Map();
    // 回执去重：同一条消息在进程内只点一次；失败提醒每个平台每进程一次。
    this.acked = new Set();
    this.ackWarned = new Set();
    // 同一条 DSH 会话里已经下发过的人物档案：同一人不再每轮重复一份路径。
    // 换会话 / 重开 / 进程重启后从零开始（最多重复一次，不影响正确性）。
    this.seenPeople = new Map();
    // 同一条 DSH 会话里已经声明过的口径（发送方式 / 关注程度 / 本人指令规则）：
    // 只在首次或取值变化时再声明一次，未变的轮次只追加消息（spec 0045）。
    this.announcedPolicy = new Map();
    // DSH 压缩会话后模型可能看不到已声明的口径：清空记录，下一轮补一次。
    this.compactionWatcher = null;
    // 进程重启：上一进程留下的 running 进度卡补一次“已暂停”。
    Promise.resolve().then(() => this.progressCards.sweep()).catch((e) => {
      this.logger.warn?.(`[im-standin] progress sweep: ${e?.message || e}`);
    });
  }

  /** 进度卡生效值：私聊 / 群聊分别走全局键，会话三态覆盖；非飞书永远 false。 */
  progressCardFor(chat) {
    if (!chat || chat.platform !== "feishu") return false;
    if (chat.kind !== "p2p" && chat.kind !== "group") return false;
    if (chat.watching !== true || chat.blocked === true) return false;
    if (chat.progress_card === true) return true;
    if (chat.progress_card === false) return false;
    const cfg = this.state.data.config?.dsh || {};
    return chat.kind === "group" ? cfg.progress_card_group === true : cfg.progress_card === true;
  }

  setHost(hostCtx, rootCtx = null) {
    this.sessionController = hostCtx.sessionController || hostCtx.get?.("sessionController") || null;
    this.sessions = hostCtx.sessions || hostCtx.get?.("sessions") || null;
    this.attachments = hostCtx.attachments || hostCtx.get?.("attachments") || null;
    this.llm = hostCtx.llm || hostCtx.get?.("llm") || null;
    this.permissionPresets = hostCtx.permissionPresets || hostCtx.get?.("permissionPresets") || null;
    this.ctx = rootCtx || hostCtx;
    this.watchCompaction(this.ctx);
  }

  /**
   * 画像由 agent 自己写，但 DSH 默认的 workspace-write 只允许写会话工作区。
   * 只有显式开启 dsh.full_access 时才把当前会话切到内置的 danger-full-access
   *（完整文件访问 + 不弹审批）；失败不阻塞 turn，由 agent 如实报告写不进去。
   */
  applySessionPermission(agent) {
    if (!this.state.data.config?.dsh?.full_access) return;
    if (!agent?.session) return;
    if (!this.permissionPresets?.set) {
      this.logger.warn?.("[im-standin] dsh.full_access=true，但宿主没有 permissionPresets；画像可能写不进去");
      return;
    }
    try {
      this.permissionPresets.set(agent.session, "danger-full-access");
    } catch (e) {
      this.logger.warn?.(`[im-standin] 设置 danger-full-access 失败: ${e?.message || e}`);
    }
  }

  setRegistry(registry) {
    this.registry = registry;
  }

  hostReady() {
    return !!(this.sessionController && this.sessions && this.ctx);
  }

  warmMinutes() {
    return Math.max(0, Number(this.state.data.config?.dsh?.warm_min) || 0);
  }

  ackEnabled() {
    return this.state.data.config?.dsh?.ack_reaction !== false;
  }

  /**
   * 本批要回执的消息：只认「@ 我」——群里的 mention；私聊只认 @ 模式下的 dm。
   * cmd / out / fyi 与「全部消息」模式的普通私聊都不点：回执不是替本人对旁观
   * 消息表态。一条都筛不出时返回空数组，不生成调用。
   */
  ackTargets(chat, messages) {
    const out = [];
    for (const m of (Array.isArray(messages) ? messages : [])) {
      if (!m || !m.msg_id) continue;
      if (chat.kind === "group") {
        if (m.kind === "mention") out.push(m);
      } else if (chat.wake_mode === "mention" && m.kind === "dm") {
        out.push(m);
      }
    }
    return out;
  }

  /**
   * 命中回执：followup 已被接受（会话已启动、任务载荷已送出）之后调用。
   * 尽力而为——不 await、不写 last_error、不影响 turn；平台没有反应命令时
   * 上层已返回 unsupported，这里直接跳过，不刷日志。
   */
  sendAck(chat, messages) {
    if (!this.ackEnabled() || !this.im || typeof this.im.react !== "function") return;
    for (const m of (Array.isArray(messages) ? messages : [])) {
      const id = String(m?.msg_id || "");
      if (!id) continue;
      const key = `${chat.platform}:${id}`;
      if (this.acked.has(key)) continue;
      this.acked.add(key);
      if (this.acked.size > 200) this.acked.delete(this.acked.values().next().value);
      Promise.resolve()
        .then(() => this.im.react(chat.platform, id, ACK_EMOJI))
        .then((r) => {
          if (!r || r.ok || r.unsupported) return;
          if (this.ackWarned.has(chat.platform)) return;
          this.ackWarned.add(chat.platform);
          this.logger.warn?.(`[im-standin] ack reaction ${key}: ${r.error || "failed"}；` +
            "飞书需要 im:message.reactions:write_only 授权");
        })
        .catch((e) => {
          if (this.ackWarned.has(chat.platform)) return;
          this.ackWarned.add(chat.platform);
          this.logger.warn?.(`[im-standin] ack reaction ${key}: ${e?.message || e}`);
        });
    }
  }

  /** 本人 ID：身份在轮询器主循环里取；适配层也允许缓存同一份。取不到就空着，不猜。 */
  selfIdFor(platform) {
    return this.poller?.identity?.[platform]?.self_id ||
      this.im?.identity?.[platform]?.self_id || "";
  }

  /** 本人显示名：只用于载荷里那句「本人：谁」，取不到就留空，不影响判断。 */
  selfNameFor(platform) {
    return String(this.poller?.identity?.[platform]?.name ||
      this.im?.identity?.[platform]?.name || "").trim();
  }

  /** 本条绑定会话已经给过的人物 ID 集合；会话换了就是新集合。 */
  peopleSeenFor(platform, chatId, sid) {
    const key = `${platform}:${chatId}:${sid}`;
    let set = this.seenPeople.get(key);
    if (!set) {
      set = new Set();
      this.seenPeople.set(key, set);
      if (this.seenPeople.size > 64) {
        const oldest = this.seenPeople.keys().next().value;
        this.seenPeople.delete(oldest);
      }
    }
    return set;
  }

  /**
   * 这条 DSH 会话已经声明过的口径（发送方式 / 关注程度 / 本人指令规则）。
   * 会话换了就是新记录；换会话 / 重开后从零开始，最多补声明一次（spec 0045）。
   */
  announcedFor(platform, chatId, sid) {
    const key = `${platform}:${chatId}:${sid}`;
    let rec = this.announcedPolicy.get(key);
    if (!rec) {
      rec = {
        send_mode: "", wake_mode: "", cmd: false, rights: null, progress_card: null, hard: false,
      };
      this.announcedPolicy.set(key, rec);
      if (this.announcedPolicy.size > 64) {
        const oldest = this.announcedPolicy.keys().next().value;
        this.announcedPolicy.delete(oldest);
      }
    }
    return rec;
  }

  /**
   * 监听会话压缩：DSH 压缩会 replace 掉一段历史（compaction/summary + 成功的
   * compaction/end），模型上下文里的口径说明可能一起消失。清掉这条会话的记录，
   * 让下一轮把口径完整重带一次（spec 0045）。失败的压缩（end 带 error）没有替换
   * 上下文，不触发重带。
   */
  watchCompaction(ctx) {
    if (this.compactionWatcher || !ctx?.on) return;
    try {
      this.compactionWatcher = ctx.on("session/event", (session, event) => {
        const type = event?.type;
        if (type === "compaction/summary") {
          this.noteCompacted(session?.id);
        } else if (type === "compaction/end" && !event?.data?.error) {
          this.noteCompacted(session?.id);
        }
      });
    } catch (e) {
      this.logger.warn?.(`[im-standin] compaction watcher unavailable: ${e?.message || e}`);
    }
  }

  /**
   * 这条会话压缩过了：清掉已声明口径与已给过的人物档案指针，下一轮重新追加一次。
   * 压缩会 replace 掉一段历史，模型上下文里可能已经看不到这些说明。
   */
  noteCompacted(sessionId) {
    const sid = String(sessionId || "");
    if (!sid) return;
    const suffix = `:${sid}`;
    for (const [key, rec] of this.announcedPolicy) {
      if (!key.endsWith(suffix)) continue;
      rec.send_mode = "";
      rec.wake_mode = "";
      rec.cmd = false;
      rec.rights = null;
      rec.progress_card = null;
      rec.hard = false;
    }
    for (const key of [...this.seenPeople.keys()]) {
      if (key.endsWith(suffix)) this.seenPeople.delete(key);
    }
  }

  /**
   * 人物档案指针：firstTurn 给全量；后续轮只给这条会话还没给过的人（seen 过滤）。
   * 都是确定性推导，不读正文、不建文件。
   */
  peopleFor(platform, chat, messages, { cap = 5, p2pFallback = true, seen = null } = {}) {
    const selfId = this.selfIdFor(platform);
    const refs = personRefs(messages, { selfId, cap });
    if (p2pFallback && !refs.length && chat?.kind === "p2p") {
      const id = chatPersonId(platform, chat, selfId);
      if (id) refs.push({ id, name: oneLine(chat.name) || id.slice(0, 8) });
    }
    return refs
      .map((r) => ({
        id: r.id,
        name: r.name,
        path: this.profiles.personPathFor(platform, r.id),
      }))
      .filter((r) => r.id && r.path && !(seen && seen.has(r.id)));
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

  /** 当前是否在跑保温轮：收尾判断不能把心跳自己当成「新活」。 */
  warmActive(platform, chatId) {
    const key = chatKey(platform, chatId);
    return this.warming.has(key) || this.active.get(key)?.warm === true;
  }

  /** 落一条 turn 事件；日志永远不能拖垮值守（字段白名单在 turn-log.js）。 */
  logTurn(event, chat, fields = {}) {
    if (!this.turnLog) return;
    try {
      this.turnLog.append(event, {
        platform: chat?.platform || "",
        chat_id: chat?.chat_id || "",
        ...fields,
      });
    } catch { /* noop */ }
  }

  /**
   * 真正在跑的轮次：已被取消、正在收尾的不算。
   * 「加入 / 重开 / 切关注程度」要立刻起会话时用它判断，否则刚 cancel 的旧轮
   * 还挂在 active 里，open 会被误判成 running 而静默不开（spec 0028）。
   */
  busy(platform, chatId) {
    const handle = this.active.get(chatKey(platform, chatId));
    return !!handle && !handle.cancelled;
  }

  deskDir() {
    return path.join(this.state.dir, "duty");
  }

  deskBusy() {
    const h = this.active.get("desk:desk");
    return !!h && !h.cancelled;
  }

  clearDeskBinding(reason = "") {
    const desk = this.state.data.desk || (this.state.data.desk = {});
    desk.dsh_session = "";
    desk.session_turns = 0;
    desk.prompt_session = "";
    desk.session_bound_at = 0;
    desk.last_error = reason;
    this.state.save();
  }

  async resolveDesk() {
    const desk = this.state.data.desk || (this.state.data.desk = {});
    const dir = this.deskDir();
    fs.mkdirSync(path.join(dir, "decisions"), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
    try { fs.chmodSync(path.join(dir, "decisions"), 0o700); } catch { /* best effort */ }
    // 值守判断是一次性的：每次新建会话，不读也不复用 desk.dsh_session。
    const made = await this.agentFromCreated(await this.sessionController.create({ cwd: dir }));
    desk.workspace = dir;
    desk.dsh_session = made.sessionId;
    desk.session_bound_at = nowSec();
    desk.session_turns = 0;
    desk.prompt_session = "";
    desk.last_error = "";
    this.state.save();
    return { agent: made.agent, sessionId: made.sessionId, cwd: dir };
  }
  /**
   * 值守台 turn：独立 desk session，不唤醒群、不 ack、不下载媒体、不 post-turn poll。
   * 启动后立即返回；onDone 在 runTurn 结束回调里读决策文件。
   */
  async deskTriage(chat, {
    eventId = "", trigger = "", review = false, messages = [], facts = {}, onDone = null,
  } = {}) {
    if (!this.hostReady()) return { ok: false, reason: "host_unavailable" };
    if (this.deskBusy()) return { ok: false, reason: "desk_busy" };
    let deskSession;
    try {
      deskSession = await this.resolveDesk();
    } catch (e) {
      const reason = String(e?.message || e?.name || e).slice(0, 160);
      const desk = this.state.data.desk || (this.state.data.desk = {});
      desk.last_error = reason;
      this.state.save();
      return { ok: false, reason };
    }
    if (deskSession.agent?.status === "running") {
      return { ok: false, reason: "desk_busy" };
    }
    const desk = this.state.data.desk || (this.state.data.desk = {});
    const prompt = buildDeskPrompt(chat, {
      facts: { ...facts, event_id: eventId }, messages, review,
    });
    const message = await makeUserMessage(prompt);
    const fake = {
      platform: "desk", chat_id: "desk", name: "值守台", kind: "group",
      wake: {}, recent: [], prompt_session: "", last_turn: { ok: null, reason: "", at: 0 },
    };
    const turnId = crypto.randomUUID();
    const handle = {
      turnId, platform: "desk", chatId: "desk",
      cancelled: false, state: "desk", since: nowSec(), startedAt: nowSec(),
      lastOk: null, lastReason: "", lastAt: 0, promptId: message.id, agent: deskSession.agent,
      done: null, desk: true,
    };
    this.active.set("desk:desk", handle);
    desk.last_error = "";
    this.state.save();
    const done = this.runTurn(handle, {
      chat: fake, agent: deskSession.agent, sid: deskSession.sessionId,
      cwd: deskSession.cwd, message, desk: true,
    });
    handle.done = done;
    if (typeof onDone === "function") {
      done.then((r) => onDone(r)).catch((e) => {
        this.logger.warn?.(`[im-standin] desk onDone: ${e?.message || e}`);
      });
    }
    return { ok: true, started: true, turn_id: turnId, session_id: deskSession.sessionId };
  }

  async wake(chat, { interrupted = false, batch = null } = {}) {
    if (!this.hostReady()) {
      return { ok: false, reason: "host_unavailable" };
    }
    const key = chatKey(chat.platform, chat.chat_id);
    // 新消息到了：先立刻打断在飞 turn，别等它跑完再排队。
    // 只记插件自己起的轮次；人 / goal / 定时任务起的轮次在 _wake() 里按 agent.status 补打断。
    const old = this.active.get(key);
    const hadActive = !!old;
    if (old) {
      this.progressCards.handoff(chat.platform, chat.chat_id, old.turnId);
      this.logTurn("cancel", chat, { turn_id: old.turnId, owner: "plugin", reason: "wake" });
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
    const run = this._wake(chat, { interrupted, batch, hadActive });
    this.starting.set(key, run);
    try {
      const result = await run;
      // 新轮没接手 handoff（没起来 / 开关已关 / 开场）：按取消收口，别让卡片一直挂着。
      // 已接手时 handoffs 已空，这里是 no-op。
      this.progressCards.abortHandoff(chat.platform, chat.chat_id, { ok: false, reason: "cancelled" });
      return result;
    } finally {
      if (this.starting.get(key) === run) this.starting.delete(key);
    }
  }

  /** 人工开启值守：立刻建会话/起一轮，不等新消息。在飞（未取消）则不打断，直接算成功。 */
  async open(chat, { reason = "join", dutyContext = null } = {}) {
    if (!this.hostReady()) return { ok: false, reason: "host_unavailable" };
    const key = chatKey(chat.platform, chat.chat_id);
    if (this.busy(chat.platform, chat.chat_id)) return { ok: true, skipped: "running" };
    // 和 wake 一样等启动阶段收口，避免两个 followup 抢同一个 session。
    const starting = this.starting.get(key);
    if (starting) {
      try { await starting; } catch { /* 上一次启动失败也继续 */ }
    }
    if (this.busy(chat.platform, chat.chat_id)) return { ok: true, skipped: "running" };
    // 被取消的旧轮仍在收尾时，_wake 会先 cancel 再 await done，然后开新轮。
    return this._wake(chat, { interrupted: false, open: true, reason, dutyContext });
  }

  /** 开场轮取最近 30 分钟内、有正文的消息当上下文（不区分是否待回）。 */
  openMessages(chat, windowSec = 1800, limit = RECENT_LIMIT) {
    const floor = nowSec() - Math.max(60, Number(windowSec) || 1800);
    return (chat?.recent || [])
      .filter((m) => String(m.content || "").trim() && (Number(m.ts_epoch) || 0) >= floor)
      .sort((a, b) => (a.ts_epoch - b.ts_epoch))
      .slice(-limit);
  }

  /** 缺口只在「上次唤醒之后新发生」时提一次，不每轮复读（spec 0065）。 */
  showGap(chat) {
    const g = chat?.gap;
    if (!g || !(Number(g.at) > 0)) return false;
    const desk = this.state.data.desk || {};
    const floor = Math.max(Number(desk.last_turn?.at) || 0, Number(desk.session_bound_at) || 0);
    return Number(g.at) > floor;
  }

  async _wake(chat, { interrupted = false, batch = null, open = false, hadActive = false,
    dutyContext = null } = {}) {
    const key = chatKey(chat.platform, chat.chat_id);
    const current = this.state.getChat(chat.platform, chat.chat_id) || chat;
    // 真实消息优先：正在启动的保温轮让位。
    const pendingWarm = this.warming.get(key);
    if (pendingWarm) pendingWarm.cancelled = true;
    if (!current.watching || current.blocked) {
      return { ok: false, reason: "not_watching" };
    }
    // 插件只追加消息：没有新消息/待回就不起 turn，也不生成空载荷。
    const opening = !!open;
    const messages = opening
      ? ((dutyContext?.messages && dutyContext.messages.length)
        ? dutyContext.messages : this.openMessages(current))
      : this.wakeMessages(current, batch);
    if (!messages.length && !opening) return { ok: false, reason: "no_pending" };
    // 回执目标在启动前就定下来：之后即使被新消息打断，也不影响这一批已送出的消息。
    const ack = opening ? [] : this.ackTargets(current, messages);
    const old = this.active.get(key);
    if (old) {
      this.progressCards.handoff(chat.platform, chat.chat_id, old.turnId);
      old.cancelled = true;
      if (old.cancel) old.cancel();
      else this.cancelHandle(old);
      try { await old.done; } catch { /* old turn already gone */ }
    }
    // 保温只做一次：第二个保温周期仍没有真实消息 -> 下一条消息换新会话。
    // 两个周期都以 max(last_turn.at, session_bound_at) 为起点，保温轮不推后它。
    const warmMin = this.warmMinutes();
    let resetMin = 0;
    if (warmMin > 0 && current.dsh_session && !this.active.has(key)) {
      const lastReal = Math.max(Number(current.last_turn?.at) || 0,
        Number(current.session_bound_at) || 0);
      if (lastReal && nowSec() - lastReal >= warmMin * 120) {
        resetMin = warmMin * 2;
        this.state.setSession(current, "", "idle");
        this.logger.info?.(`[im-standin] warm expiry ${key}: idle >= ${warmMin * 2}min`);
      }
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

      // 在飞的那一轮不一定是插件起的：人可以在 DSH 面板里直接发消息，goal / 定时任务
      // 也会在同一会话里起轮。此时 active 里没有句柄，但 agent 正在跑；不打断的话
      // followup 只会进 next-turn 排队，@ 消息要等那一轮结束（spec 0038）。
      // 开场（加入值守）不打断，保持 spec 0025。
      if (!opening && !hadActive && agent.status === "running") {
        try { agent.cancel({ kind: "user" }, { keepInbox: true }); } catch { /* best effort */ }
        interrupted = true;
        this.logTurn("cancel", current, { turn_id: "", owner: "foreign", reason: "wake" });
      }

      // 配置开启时才把会话放进 danger-full-access；agent 需要它直接写记忆文件。
      this.applySessionPermission(agent);
      // 群：工作本 + 人物档案；单聊：对方的人物档案一份（spec 0035）。
      const selfId = this.selfIdFor(current.platform);
      const memory = this.profiles.memoryFor(current.platform, current, selfId);
      const legacyPath = memory.single
        ? this.profiles.legacyBookFor(current.platform, current, selfId) : "";
      const legacyHistory = legacyPath ? this.profiles.historyPathFor(legacyPath) : "";
      const firstTurn = current.prompt_session !== sid;
      const seen = this.peopleSeenFor(current.platform, current.chat_id, sid);
      const media = await this.resolveMedia(current, messages, agent);
      const people = memory.single ? [] : this.peopleFor(current.platform, current, messages, {
        cap: 5, seen: firstTurn ? null : seen,
      });
      for (const p of people) seen.add(p.id);
      this.logTurn(opening ? "open" : "wake", current, {
        turn_id: turnId, count: messages.length, interrupted, first_turn: firstTurn,
      });
      // 值班单点优先；还没固化（未值守/老数据）时跟随新建默认。
      const sendMode = current.send_mode || this.state.data.config.send_mode_default || "draft";
      const wakeMode = current.wake_mode ||
        (current.kind === "group" ? "mention" : "all");
      const progressCard = opening ? false : this.progressCardFor(current);
      // 发言权：默认口径一直有效，本群写了自己的那一段就用它（spec 0051）。不改变发送方式。
      const rights = current.kind === "group"
        ? this.profiles.rightsFor(current.platform, current, selfId)
        : { applicable: false, custom: false };
      const rightsCustom = !!rights.custom;
      const selfName = this.selfNameFor(current.platform);
      // 这条会话已经声明过的口径：未变的轮次不再复读（spec 0045）。
      // 只有 followup 成功后才写回（runTurn 的 onSent），载荷没送出去不算声明过。
      const announced = this.announcedFor(current.platform, current.chat_id, sid);
      const hasCmd = messages.some((m) => m.kind === "cmd");
      const rememberAnnounced = () => {
        announced.send_mode = sendMode;
        announced.wake_mode = wakeMode;
        announced.progress_card = progressCard;
        announced.hard = true;
        if (rights.applicable) announced.rights = rightsCustom;
        if (hasCmd) announced.cmd = true;
      };
      const prompt = opening
        ? buildOpenPrompt(current.platform, current.name, current.chat_id, messages, {
            bookPath: memory.path, single: memory.single, legacyPath, legacyHistory, people,
            wakeMode, resetMin, kind: current.kind,
            sendMode, dutyContext,
            selfId, selfName, rightsCustom,
          })
        : buildWakePrompt(current.platform, current.name, current.chat_id, messages, {
            bookPath: memory.path, single: memory.single, legacyPath, legacyHistory, people,
            interrupted, firstTurn, mediaMap: media.map,
            wakeMode, resetMin, kind: current.kind,
            sendMode, dutyContext, announced,
            selfId, selfName, rightsCustom,
            progressCard,
            silentCount: current.kind === "group" ? silentNoMention(current) : 0,
            gap: this.showGap(current),
          });
      const message = await makeUserMessage(prompt, media.parts);
      handle.promptId = message.id;
      // 载荷已经写进会话：这时候才算「投递过」，失败不落标记（spec 0065）。
      this.state.markDelivered(current, messages.map((m) => m.msg_id));
      const effective = session.cwd || "";
      this.active.set(key, handle);
      handle.done = this.runTurn(handle, {
        chat: current, agent, sid, cwd: effective, message, ack, onSent: rememberAnnounced,
        progress: progressCard,
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
      this.logTurn("wake_failed", current, { turn_id: turnId, reason });
      return { ok: false, reason };
    }
  }

  wakeMessages(chat, batch) {
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

  imageLimits() {
    const lim = this.attachments?.imageLimits || {};
    const maxOne = Number(lim.maxImageBytes) || 10 * 1024 * 1024;
    return {
      maxImages: Number(lim.maxImagesPerMessage) || 4,
      maxOne,
      maxTotal: Number(lim.maxMessageImageBytes) || maxOne,
      mediaTypes: Array.isArray(lim.mediaTypes) ? lim.mediaTypes : null,
    };
  }

  existingFiles(row) {
    const out = [];
    for (const p of (row?.media_paths || [])) {
      try {
        if (fs.statSync(p).isFile()) out.push(p);
      } catch { /* 已清理/手删，下面重下 */ }
    }
    return out;
  }

  kindForPath(file, msgType) {
    if (imageMediaType(file)) return "image";
    if (msgType === "audio" || msgType === "voice") return "audio";
    if (msgType === "media" || msgType === "video") return "video";
    return "file";
  }

  infoFromPaths(message, row, paths) {
    const msgType = String(row.msg_type || message.msg_type || "");
    const files = paths.map((p) => {
      let size = 0;
      try { size = fs.statSync(p).size; } catch { /* size unknown */ }
      return {
        path: p, kind: this.kindForPath(p, msgType), name: path.basename(p),
        size, attached: false, reason: "",
      };
    });
    return {
      status: "ok", files,
      fp: (String(message.platform || "") === "wecom" || String(row.platform || "") === "wecom")
        && String(message.msg_id || "").startsWith("fp_"),
    };
  }

  /** 4 张图 / 10MB 上限（优先用 DSH attachments.imageLimits）；超出的只给路径。 */
  applyBudget(files, budget, limits, candidates) {
    for (const f of files) {
      if (f.kind === "image") {
        if (budget.images >= limits.maxImages) f.reason = "over_limit";
        else if (f.size > limits.maxOne) f.reason = "too_large";
        else if (budget.imageBytes + f.size > limits.maxTotal) f.reason = "over_limit";
        else {
          budget.images += 1;
          budget.imageBytes += f.size;
          candidates.push(f);
        }
      }
      budget.totalBytes += f.size;
    }
    if (budget.totalBytes > limits.maxTotal * 2) budget.exhausted = true;
  }

  async modelSupportsImages(agent) {
    if (!this.llm?.resolveModelInfo) return false;
    let sel = null;
    // 首选 DSH 给这个 agent 装配 prompt 时用的 exact selection；新建会话也拿得到。
    try {
      const picked = this.sessionController?.selectionFor?.(agent)?.current;
      if (picked?.provider && picked?.model) sel = { provider: picked.provider, model: picked.model };
    } catch { /* fall through */ }
    if (!sel) {
      try {
        const header = agent?.session?.requestHeader?.();
        const cfg = header?.config;
        if (cfg?.provider && cfg?.model) sel = { provider: cfg.provider, model: cfg.model };
      } catch { /* fall through */ }
    }
    if (!sel) {
      try {
        const dm = this.ctx?.get?.("agentDefaultModel");
        const picked = dm?.currentSelection?.();
        if (picked?.provider && picked?.model) sel = { provider: picked.provider, model: picked.model };
      } catch { /* fall through */ }
    }
    if (!sel) return false;
    try {
      const info = await this.llm.resolveModelInfo(sel.provider, sel.model);
      return Array.isArray(info?.inputModalities) && info.inputModalities.includes("image");
    } catch {
      return false;
    }
  }

  async admitImages(candidates, agent) {
    if (!candidates.length) return [];
    if (!this.attachments?.admitPromptContent) {
      for (const f of candidates) f.reason = "no_attachments";
      return [];
    }
    if (!(await this.modelSupportsImages(agent))) {
      for (const f of candidates) f.reason = "model_no_image";
      return [];
    }
    const limits = this.imageLimits();
    const parts = [];
    for (const f of candidates) {
      const mediaType = imageMediaType(f.path);
      if (!mediaType || (limits.mediaTypes && !limits.mediaTypes.includes(mediaType))) {
        f.reason = "unsupported_format";
        continue;
      }
      let data;
      try {
        data = fs.readFileSync(f.path).toString("base64");
      } catch {
        f.reason = "missing_file";
        continue;
      }
      try {
        const admitted = await this.attachments.admitPromptContent([{
          type: "image", mediaType, data, name: f.name,
        }]);
        const image = (admitted || []).find((p) => p?.type === "image");
        if (!image) throw new Error("no_image_part");
        parts.push(image);
        f.attached = true;
      } catch (e) {
        f.reason = "admit_failed";
        this.logger.warn?.(`[im-standin] image admit failed: ${e?.message || e}`);
      }
    }
    return parts;
  }

  /**
   * 只处理本次唤醒要交给 agent 的消息：sticker 只标表情；适配类型下载并
   * 复用已有 media_paths；未适配/失败只留标记。图片在模型支持时转成
   * DSH image block，其余给本地路径。
   */
  async resolveMedia(chat, messages, agent) {
    const map = new Map();
    const list = (messages || []).filter((m) => m && m.msg_type && m.msg_type !== "text");
    if (!list.length) return { map, parts: [] };
    const limits = this.imageLimits();
    const budget = { images: 0, imageBytes: 0, totalBytes: 0, exhausted: false };
    const candidates = [];
    let changed = false;
    for (const m of list) {
      const msgType = String(m.msg_type || "");
      if (msgType === "sticker") {
        map.set(m.msg_id, { sticker: true });
        continue;
      }
      const row = chat.recent.find((x) => x.msg_id === m.msg_id) || m;
      const fp = chat.platform === "wecom" && String(m.msg_id || "").startsWith("fp_");
      if (!MEDIA_ADAPTERS[chat.platform]?.types.includes(msgType)) {
        map.set(m.msg_id, { status: "unsupported", fp });
        continue;
      }
      const existing = this.existingFiles(row);
      if (existing.length) {
        if (existing.length !== (row.media_paths || []).length) {
          row.media_paths = existing;
          changed = true;
        }
        const info = this.infoFromPaths(m, row, existing);
        info.fp = fp;
        this.applyBudget(info.files, budget, limits, candidates);
        map.set(m.msg_id, info);
        continue;
      }
      if (budget.exhausted) {
        map.set(m.msg_id, { status: "failed", fp, error: "budget" });
        continue;
      }
      const download = await this.im?.downloadMedia?.(chat.platform, chat.chat_id, m, {
        timeoutMs: 20000,
      }) || { ok: false, files: [], error: "im_unavailable" };
      if (download.sticker) {
        map.set(m.msg_id, { sticker: true });
        continue;
      }
      if (download.no_media) continue; // 纯文字 post：不下载也不提示 CLI
      if (download.unsupported) {
        map.set(m.msg_id, { status: "unsupported", fp, error: download.error });
        continue;
      }
      if (!download.ok || !download.files?.length) {
        map.set(m.msg_id, { status: "failed", fp, error: download.error });
        continue;
      }
      const files = download.files.map((f) => {
        let size = 0;
        try { size = fs.statSync(f.path).size; } catch { /* unknown */ }
        return { ...f, size, attached: false, reason: "" };
      });
      this.applyBudget(files, budget, limits, candidates);
      const info = { status: "ok", files, fp, error: download.error || "" };
      map.set(m.msg_id, info);
      row.media_paths = files.map((f) => f.path);
      changed = true;
    }
    if (changed) this.state.save();
    const parts = await this.admitImages(candidates, agent);
    return { map, parts };
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
        if (code === "session/not-found") {
          resolved = null;
          chat.last_reset = { at: nowSec(), reason: "missing" };
        } else if (code === "session/writer-held") throw new Error("session_locked_other_host");
        else throw new Error(`${e?.name || "Error"}: ${e?.message || e}`);
      }
      if (resolved && resolved.error) {
        const code = resolved.error.code || "";
        if (code === "session/not-found") {
          sid = "";
          chat.last_reset = { at: nowSec(), reason: "missing" };
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
          chat.last_reset = { at: nowSec(), reason: "workspace" };
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

  /** 只解析已绑定的会话，不新建；会话不在或工作区不符都返回 null。 */
  async resolveExisting(chat) {
    const sid = String(chat.dsh_session || "");
    if (!sid || !this.hostReady()) return null;
    let resolved;
    try {
      resolved = await this.sessionController.resolveAgent(sid);
    } catch (e) {
      if (e?.code === "session/not-found") return null;
      throw e;
    }
    if (!resolved || resolved.error || !resolved.agent) return null;
    const agent = resolved.agent;
    const effective = workspaces.resolveForChat(chat).path || "";
    if (effective) {
      const cwd = agent.session?.header?.cwd || agent.session?.cwd || agent.cwd || "";
      const norm = cwd ? workspaces.normalize(cwd) : "";
      if (norm && norm !== effective) return null;
    }
    return { agent, sessionId: sid, cwd: effective };
  }

  /**
   * 值守心跳：在已绑定的会话里跑一轮维护（续上下文缓存 + 按 skill 归并画像）。
   * 不新建会话、不计入 session_turns、不推进真实 turn 的时钟；真实消息到达时会被取消。
   * 启动阶段与 wake() 共用 starting 串行：真实消息先到就让它赢，别把心跳插在前面。
   */
  async warm(chat) {
    if (!this.hostReady()) return { ok: false, reason: "host_unavailable" };
    const current = this.state.getChat(chat.platform, chat.chat_id) || chat;
    const key = chatKey(current.platform, current.chat_id);
    if (!current.watching || current.blocked) return { ok: false, reason: "not_watching" };
    if (!current.dsh_session) return { ok: false, reason: "no_session" };
    // 首轮完整载荷还没被消费过：让真实唤醒先把 skill 入口送进去，别让保温轮当首轮。
    if (current.prompt_session !== current.dsh_session) return { ok: false, reason: "no_prompt_session" };
    if (this.active.has(key) || this.starting.has(key)) return { ok: false, reason: "running" };
    const token = { cancelled: false };
    this.warming.set(key, token);
    const run = (async () => {
      try {
        const existing = await this.resolveExisting(current);
        if (token.cancelled || this.active.has(key)) return { ok: false, reason: "cancelled" };
        if (!existing) return { ok: false, reason: "no_session" };
        const { agent, sessionId: sid, cwd } = existing;
        // 会话里可能有插件之外的轮次在跑（人在 DSH 面板里直接发消息 / goal 驱动）。
        // 保温是后台维护，不该为它打断人的活，也不该把心跳排到别人后面等一轮。
        if (agent.status === "running") return { ok: false, reason: "running" };
        this.applySessionPermission(agent);
        // 心跳的记忆文件与真实轮一致：群两层，单聊只有对方的人物档案。
        const selfId = this.selfIdFor(current.platform);
        const memory = this.profiles.memoryFor(current.platform, current, selfId);
        const legacyPath = memory.single
          ? this.profiles.legacyBookFor(current.platform, current, selfId) : "";
        const legacyHistory = legacyPath ? this.profiles.historyPathFor(legacyPath) : "";
        // 心跳只整理「最近 10 条里不同发言人」的人物档案（≤3），没发言人就不给档案块；
        // 单聊只有一份档案，不走这个块。
        const people = memory.single ? [] : this.peopleFor(current.platform, current, current.recent, {
          cap: 3, p2pFallback: false,
        });
        const seenWarm = this.peopleSeenFor(current.platform, current.chat_id, sid);
        for (const p of people) seenWarm.add(p.id);
        const lastReal = Math.max(Number(current.last_turn?.at) || 0,
          Number(current.session_bound_at) || 0);
        const idleMin = lastReal ? Math.round((nowSec() - lastReal) / 60) : 0;
        const closeAfterDays = Math.max(0,
          Number(this.state.data.config?.duty?.close_after_days) || 0);
        const prompt = buildWarmPrompt(current.platform, current.name, current.chat_id, {
          bookPath: memory.path, single: memory.single, legacyPath, legacyHistory, people, idleMin,
          closeAfterDays,
        });
        const message = await makeUserMessage(prompt);
        // 构造载荷期间可能已有真实消息进来：再确认一次，别把心跳插到真实回复后面。
        if (token.cancelled || this.active.has(key)) return { ok: false, reason: "cancelled" };
        const turnId = crypto.randomUUID();
        const handle = {
          turnId, platform: current.platform, chatId: current.chat_id,
          cancelled: false, state: "warm", since: nowSec(), startedAt: nowSec(),
          lastOk: null, lastReason: "", lastAt: 0, promptId: message.id, agent, done: null,
          warm: true,
        };
        this.active.set(key, handle);
        this.logTurn("warm", current, { turn_id: turnId, state: "warm" });
        handle.done = this.runTurn(handle, {
          chat: current, agent, sid, cwd, message, warm: true,
        });
        this.state.save();
        return { ok: true, started: true, turn_id: turnId, state: "warm" };
      } catch (e) {
        const reason = typeof e === "string" ? e : (e?.message || e?.name || "warm_failed");
        this.logger.warn?.(`[im-standin] warm ${key}: ${reason}`);
        return { ok: false, reason };
      } finally {
        if (this.warming.get(key) === token) this.warming.delete(key);
      }
    })();
    this.starting.set(key, run);
    try {
      return await run;
    } finally {
      if (this.starting.get(key) === run) this.starting.delete(key);
    }
  }

  runTurn(handle, { chat, agent, sid, cwd, message, warm = false, desk = false, progress = false, ack = [], onSent = null }) {
    return new Promise((resolve) => {
      const key = chatKey(chat.platform, chat.chat_id);
      // 停滞超时（默认 600s）+ 单轮总上限兜底（默认 3600s，0 = 不限），见 spec 0034。
      const cfgDsh = this.state.data.config?.dsh || {};
      const timeoutSec = Math.max(120, Number(cfgDsh.timeout) || 600);
      const capSec = Math.max(0, Number(cfgDsh.turn_cap_sec ?? 3600) || 0);
      const startedAt = Date.now();
      let promptSeen = false;
      const warmTexts = [];
      let lastTurnStart = null;
      let turnStarted = false;
      let turnNumber = null;
      let progressArmed = false;
      let progressStarted = false;
      let settled = false;
      let watchdog = null;
      let stop = () => {};

      const settle = (result) => {
        if (settled) return;
        settled = true;
        if (watchdog) watchdog.stop();
        try { stop(); } catch { /* listener already gone */ }
        resolve(result);
      };

      const finish = (result) => {
        if (!warm && !desk && progress) {
          this.progressCards.finish(chat.platform, chat.chat_id, handle.turnId, result);
          if (!progressStarted) {
            this.progressCards.abortHandoff(chat.platform, chat.chat_id, result);
          }
        }
        if (handle.cancelled && !handle.timedOut) {
          const wasActive = this.active.get(key)?.turnId === handle.turnId;
          if (wasActive) {
            this.active.delete(key);
            if (!warm && !desk) {
              chat.wake.active = false;
              chat.wake.failed = false;
              chat.wake.turn_id = "";
              this.state.save();
            }
          }
          this.logTurn(warm ? "warm_end" : "turn_end", chat, {
            turn_id: handle.turnId, ok: false, reason: "cancelled",
            ms: Date.now() - startedAt,
          });
          settle({ ok: false, reason: "cancelled" });
          return;
        }
        if (this.active.get(key)?.turnId !== handle.turnId) {
          settle(result);
          return;
        }
        this.active.delete(key);
        if (desk) {
          const ds = this.state.data.desk || (this.state.data.desk = {});
          ds.session_turns = Math.max(0, Number(ds.session_turns) || 0) + 1;
          ds.last_turn = {
            ok: !!result.ok,
            reason: result.ok ? "" : (result.reason || "turn_failed"),
            at: nowSec(),
          };
          ds.last_error = result.ok ? "" : (result.reason || "turn_failed");
          this.state.save();
          this.logTurn("desk_end", chat, {
            turn_id: handle.turnId, ok: !!result.ok,
            reason: result.ok ? "" : (result.reason || "turn_failed"),
            ms: Date.now() - startedAt,
          });
          settle(result);
          return;
        }
        if (warm) {
          // 保温轮不是真实工作：只记自己的结果，不碰 session_turns / last_turn / wake，
          // 否则闲置时钟会被每小时一次心跳推后，3 小时重开永远不触发。
          chat.last_warm_at = nowSec();
          chat.last_warm_ok = !!result.ok;
          handle.lastOk = !!result.ok;
          handle.lastReason = result.ok ? "" : (result.reason || "turn_failed");
          handle.lastAt = nowSec();
          if (result.ok && chat.watching && !chat.blocked &&
              this.state.pendingCount(chat) === 0) {
            const days = Math.max(0, Number(this.state.data.config?.duty?.close_after_days) || 0);
            const reason = days > 0 ? duty.parseClosingMarker(warmTexts.join("\n")) : "";
            if (reason && duty.markClosing(chat, { reason, now: nowSec(), days })) {
              this.logger.info?.(`[im-standin] task-done closing marked: ${key}`);
            }
          }
          this.state.save();
          if (!result.ok) {
            this.logger.warn?.(`[im-standin] warm turn ${key}: ${handle.lastReason}`);
          }
          this.logTurn("warm_end", chat, {
            turn_id: handle.turnId, ok: !!result.ok, reason: handle.lastReason,
            ms: Date.now() - startedAt,
          });
          settle(result);
          return;
        }
        if (result.ok) {
          // turn 成功说明 prompt 已被消费；事件漏掉时也补一次。
          if (chat.prompt_session !== sid) {
            chat.prompt_session = sid;
          }
          this.state.bumpTurn(chat, true);
          handle.lastOk = true;
          handle.lastReason = "";
          handle.lastAt = nowSec();
          // 跑完立刻补拉一次：把 agent 自己发出的消息收回来，pending 才能闭合。
          setTimeout(() => {
            this.poller?.pollChat(chat.platform, chat.chat_id, { force: true })
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
        this.logTurn("turn_end", chat, {
          turn_id: handle.turnId, ok: !!result.ok,
          reason: result.ok ? "" : (result.reason || "turn_failed"),
          ms: Date.now() - startedAt,
        });
        settle(result);
      };

      const cancel = () => {
        if (settled) return;
        handle.cancelled = true;
        this.cancelHandle(handle);
        finish({ ok: false, reason: "cancelled" });
      };
      handle.cancel = cancel;

      const armProgress = () => {
        if (warm || desk || !progress || progressArmed || !promptSeen || !turnStarted) return;
        progressArmed = true;
        this.progressCards.arm(chat.platform, chat.chat_id, handle.turnId, turnNumber);
      };

      const collect = (event) => {
        const type = event?.type;
        armProgress();
        if (!warm && !desk && progress && progressArmed) {
          this.progressCards.note(chat.platform, chat.chat_id, event, handle.turnId);
        }
        if (type === "assistant/message" && warm) {
          const text = assistantText(event.data);
          if (text.trim()) {
            warmTexts.push(text);
            if (warmTexts.length > 6) warmTexts.shift();
          }
        }
        if (type === "user/message") {
          if (event?.data?.id && event.data.id === handle.promptId) {
            promptSeen = true;
            handle.promptSeen = true;
            // 这一轮的载荷已经进 agent 的上下文：之后只追加新消息。
            if (!desk && chat.prompt_session !== sid) {
              chat.prompt_session = sid;
              this.state.save();
            }
            // DSH 在轮次边界先发 turn/start，再提交 user/message。
            // 监听挂晚的两种情况：
            // · DSH 没发 turn/start（手动 steer 进已在跑的轮）→ 认作当前唯一在跑的轮；
            // · turn/start 比 user/message 晚到 → 下面 turn/start 分支补上。
            if (!turnStarted) {
              if (lastTurnStart != null) {
                turnStarted = true;
                turnNumber = lastTurnStart;
              } else if (!warm || desk) {
                turnStarted = true;
                turnNumber = null; // 轮号未知，turn/end 不再比对
                handle.adopted = true;
              }
            }
            armProgress();
            this.logTurn("prompt_seen", chat, {
              turn_id: handle.turnId, wait_ms: Date.now() - startedAt,
              adopted: !!handle.adopted,
            });
          }
          return;
        }
        if (type === "turn/start") {
          lastTurnStart = event.data?.turn ?? null;
          if (promptSeen && !turnStarted) {
            turnStarted = true;
            turnNumber = lastTurnStart;
          }
          armProgress();
          return;
        }
        if (type === "turn/end") {
          if (!turnStarted) return;
          if (turnNumber !== null && event.data?.turn !== turnNumber) return;
          const reason = event.data?.reason || { kind: "completed" };
          const kind = reason.kind || "completed";
          if (kind === "completed") {
            finish({ ok: true, reason: "", session_id: sid, cwd, ms: Date.now() - startedAt });
          } else if (kind === "error") {
            const error = reason.error?.message || reason.error?.code || "error";
            finish({ ok: false, reason: `error: ${error}`, session_id: sid, cwd, ms: Date.now() - startedAt });
          } else {
            finish({ ok: false, reason: kind, session_id: sid, cwd, ms: Date.now() - startedAt });
          }
        }
      };

      try {
        stop = this.ctx.on("session/event", (session, event) => {
          if (agent.session && session !== agent.session && session?.id !== agent.session?.id) return;
          // 只有本轮载荷已进会话，这个会话的事件才算本轮活着（spec 0038）。
          // 载荷还排在 next-turn 时，别人的轮次事件不能给这轮续命，否则永远不超时。
          if (watchdog && promptSeen) watchdog.touch();
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
      // 先挂等待期再 followup：DSH 可能同步回放 turn/start，不能等 followup 返回才建 tracker。
      if (!warm && !desk && progress) {
        progressStarted = !!this.progressCards.begin({ chat, turnId: handle.turnId });
      }
      try {
        agent.followup(message);
      } catch (e) {
        finish({ ok: false, reason: `followup_failed: ${e?.message || e}` });
        return;
      }
      this.logTurn(warm ? "warm_sent" : "followup", chat, { turn_id: handle.turnId });
      // 载荷确实送进会话后才记账（口径按 DSH 会话记住，spec 0045）；记账失败不拖垮本轮。
      if (onSent) {
        try { onSent(); } catch { /* 记账失败下一轮再补声明一次 */ }
      }
      // 会话已启动、载荷已送出：现在才点回执；失败不影响本轮。
      if (!desk) this.sendAck(chat, ack);
      watchdog = turnWatchdog({
        stallSec: timeoutSec,
        capSec,
        onTimeout: (reason) => {
          if (settled) return;
          handle.cancelled = true;
          handle.timedOut = true;
          this.cancelHandle(handle);
          finish({ ok: false, reason, session_id: sid, cwd, ms: Date.now() - startedAt });
        },
      });
      watchdog.start();

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
    const chat = this.state.getChat(platform, chatId) || { platform, chat_id: chatId };
    this.logTurn("cancel", chat, { turn_id: handle.turnId, owner: "plugin", reason });
    this.logger.info?.(`[im-standin] cancel ${key}: ${reason}`);
    return true;
  }

  stopAll() {
    this.progressCards?.stopAll();
    for (const handle of this.active.values()) {
      handle.cancelled = true;
      this.cancelHandle(handle);
      if (handle.cancel) handle.cancel();
    }
    this.active.clear();
    this.state.save();
  }
}
