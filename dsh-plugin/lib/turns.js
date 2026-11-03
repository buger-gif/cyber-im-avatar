/**
 * turns.js — 把唤醒 prompt 送进绑定的 DSH live 会话，等这一轮结束。
 *
 * 没有 headless 子进程：sessionController.resolveAgent() 拿到的就是 DSH 里
 * 同一个 agent；UI 打开它不会再抢 session.lock。一个宿主进程内按 chat 串行；
 * 新消息到达时先取消旧 turn，再在同一 session 里跑新的。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { chatKey } from "./state.js";
import { MEDIA_ADAPTERS, MEDIA_LABELS, imageMediaType } from "./im.js";
import * as workspaces from "./workspaces.js";

const PLAT_LABEL = { feishu: "飞书", wecom: "企业微信", dingtalk: "钉钉" };

function nowSec() {
  return Date.now() / 1000;
}

/**
 * 聊天正文/昵称是不可信数据：DSH 会扫描 source.kind === "user" 的整段文本，
 * 空白边界的 `/name` 会被当成 skill 手势；客户正文不能触发别的 skill。
 * 只改手势形状与 HTML 注释起始标记，URL、路径、分数不动。
 */
export function sanitizeUntrusted(text) {
  return String(text == null ? "" : text)
    .replace(/<!--/g, "<\u200b!--")
    .replace(/(^|\s)\/([A-Za-z][A-Za-z0-9_-]*)(?=\s|$)/g, "$1\uFF0F$2");
}

async function makeUserMessage(text, extraParts = []) {
  return Object.freeze({
    id: crypto.randomUUID(),
    role: "user",
    content: [{ type: "text", text }, ...extraParts],
    source: { kind: "user" },
  });
}

function formatMsgLine(m, mediaInfo = null, platform = "") {
  let text = String(m.content || "").replace(/\s+/g, " ").trim();
  if (!text) text = "（正文在线查）";
  if (text.length > 800) text = text.slice(0, 800) + "…";
  text = sanitizeUntrusted(text);
  const note = mediaNote(m, mediaInfo, platform);
  let body = text;
  if (note) {
    const label = MEDIA_LABELS[m.msg_type] || "";
    const bare = (label && text === label) || text === "（正文在线查）" ||
      (m.msg_type === "file" && text.startsWith("[文件:"));
    body = bare ? note : `${text} ${note}`;
  }
  const tag = sanitizeUntrusted(m.kind === "out" ? "我" : (m.sender_name || "对方"));
  return `- [${m.ts || ""}] ${tag}: ${body}`;
}

const ATTACH_REASON = {
  over_limit: "超出本次附带上限",
  too_large: "图片过大，未随载荷附带",
  model_no_image: "当前模型不可读图",
  no_attachments: "DSH 附件服务不可用",
  unsupported_format: "图片格式不支持直接附带",
  admit_failed: "附带失败",
  missing_file: "本地文件已不存在",
};

function mediaRef(m, info, platform) {
  if (info?.fp || (platform === "wecom" && String(m.msg_id || "").startsWith("fp_"))) {
    return "按时间/发送者回查";
  }
  const parts = [];
  if (m.msg_id) parts.push(`msg_id: ${m.msg_id}`);
  if (m.media_id) parts.push(`media_id: ${m.media_id}`);
  return parts.join("，") || "msg_id 不可用";
}

function mediaNote(m, info, platform = "") {
  if (!info || info.sticker) return "";
  const label = MEDIA_LABELS[m.msg_type] || "[媒体]";
  if (info.status === "unsupported") {
    return `${label}（未适配；可用 CLI 取，${mediaRef(m, info, platform)}）`;
  }
  if (info.status === "failed") {
    return `${label}（下载失败；可用 CLI 取，${mediaRef(m, info, platform)}）`;
  }
  const files = (info.files || []).filter((f) => f && f.path);
  if (!files.length) return `${label}（未适配；可用 CLI 取，${mediaRef(m, info, platform)}）`;
  const images = files.filter((f) => f.kind === "image");
  const others = files.filter((f) => f.kind !== "image");
  const pieces = [];
  const attached = images.filter((f) => f.attached);
  const detached = images.filter((f) => !f.attached);
  if (attached.length) {
    pieces.push(`[图片]（已随载荷附带；本地：${attached.map((f) => f.path).join("、")}）`);
  }
  if (detached.length) {
    const why = ATTACH_REASON[detached[0].reason] || "未随载荷附带";
    pieces.push(`[图片]（本地：${detached.map((f) => f.path).join("、")}；${why}）`);
  }
  if (others.length) {
    const labels = others.map((f) => {
      if (f.kind === "audio") return "[语音]";
      if (f.kind === "video") return "[视频]";
      return f.name ? `[文件: ${f.name}]` : label;
    });
    pieces.push(`${[...new Set(labels)].join("、")}（本地：${others.map((f) => f.path).join("、")}）`);
  }
  return pieces.join("；") || `${label}（本地：${files.map((f) => f.path).join("、")}）`;
}

const MEDIA_HINT = "媒体说明：已适配的图片随载荷附带，文件/音视频给了本地路径；" +
  "标注“未适配/下载失败”的再按 skill 用 CLI 取，拿不到就如实说，不要猜。";

function mediaFor(map, msgId) {
  if (!map) return null;
  if (typeof map.get === "function") return map.get(msgId) || null;
  return map[msgId] || null;
}

function mediaSize(map) {
  if (!map) return 0;
  if (typeof map.size === "number") return map.size;
  return Object.keys(map).length;
}

function payloadNote(count) {
  return `本次只追加这 ${Math.max(1, Number(count) || 0)} 条新消息；更早上下文按 skill 在线拉。`;
}

/**
 * 一次唤醒 = 只追加本次新到的消息。首轮多一行 `/cyber-im-avatar` 入口；
 * 后续不带入口，但始终带平台/对象、chat_id、运行形态与画像路径。
 * 画像正文由 agent 自己按路径读，插件不注入、不解析、不回写。
 */
export function buildWakePrompt(platform, chatName, chatId, messages, {
  profilePath = "", interrupted = false, firstTurn = false, mediaMap = null,
} = {}) {
  const label = PLAT_LABEL[platform] || platform;
  const safeName = sanitizeUntrusted(chatName || chatId);
  const parts = [];
  if (firstTurn) parts.push("/cyber-im-avatar");
  if (interrupted) {
    parts.push("（上一轮被新消息打断，以最新上下文为准；未完成的事重新判断。）");
  }
  parts.push(`值守命中 · ${label} · ${safeName} · 新消息`);
  parts.push(`chat_id：${chatId}`);
  parts.push("运行形态：DSH 插件壳；监听、水位、唤醒由插件负责，不要挂监听，不要运行 listen_cli/bootstrap.py。");
  if (profilePath) {
    parts.push(`画像文件：${profilePath}（起草前自己读；学到长期事实就直接改这个文件，插件不代写。）`);
  }
  for (const m of messages.slice().sort((a, b) => (a.ts_epoch - b.ts_epoch))) {
    parts.push(formatMsgLine(m, mediaFor(mediaMap, m.msg_id), platform));
  }
  if (mediaSize(mediaMap)) parts.push(MEDIA_HINT);
  parts.push(payloadNote(messages.length));
  if (firstTurn) {
    parts.push("按 skill 处理这通会话；画像只改当前对象这一份，不要写 state.json / env.json / media。");
  }
  return parts.join("\n");
}

export class Turns {
  constructor({ state, profiles, poller = null, im = null, media = null, logger = console }) {
    this.state = state;
    this.profiles = profiles;
    this.poller = poller;
    this.im = im;
    this.media = media;
    this.logger = logger;
    this.sessionController = null;
    this.sessions = null;
    this.registry = null;
    this.attachments = null;
    this.llm = null;
    this.permissionPresets = null;
    this.ctx = null;
    this.active = new Map();
    this.starting = new Map();
  }

  setHost(hostCtx, rootCtx = null) {
    this.sessionController = hostCtx.sessionController || hostCtx.get?.("sessionController") || null;
    this.sessions = hostCtx.sessions || hostCtx.get?.("sessions") || null;
    this.attachments = hostCtx.attachments || hostCtx.get?.("attachments") || null;
    this.llm = hostCtx.llm || hostCtx.get?.("llm") || null;
    this.permissionPresets = hostCtx.permissionPresets || hostCtx.get?.("permissionPresets") || null;
    this.ctx = rootCtx || hostCtx;
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

  async wake(chat, { interrupted = false, batch = null } = {}) {
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
    const run = this._wake(chat, { interrupted, batch });
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
    // 插件只追加消息：没有新消息/待回就不起 turn，也不生成空载荷。
    const messages = this.wakeMessages(current, batch);
    if (!messages.length) return { ok: false, reason: "no_pending" };
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

      // 配置开启时才把会话放进 danger-full-access；agent 需要它直接写画像。
      this.applySessionPermission(agent);
      const profilePath = this.profiles.pathFor(current.platform, current.chat_id, current.name);
      const firstTurn = current.prompt_session !== sid;
      const media = await this.resolveMedia(current, messages, agent);
      const prompt = buildWakePrompt(current.platform, current.name, current.chat_id, messages, {
        profilePath, interrupted, firstTurn, mediaMap: media.map,
      });
      const message = await makeUserMessage(prompt, media.parts);
      handle.promptId = message.id;
      const effective = session.cwd || "";
      this.active.set(key, handle);
      handle.done = this.runTurn(handle, {
        chat: current, agent, sid, cwd: effective, message,
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

  runTurn(handle, { chat, agent, sid, cwd, message }) {
    return new Promise((resolve) => {
      const key = chatKey(chat.platform, chat.chat_id);
      const timeoutSec = Math.max(30, Number(this.state.data.config?.dsh?.timeout) || 600);
      const startedAt = Date.now();
      let promptSeen = false;
      let lastTurnStart = null;
      let turnStarted = false;
      let turnNumber = null;
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
        if (type === "turn/end") {
          if (!turnStarted || event.data?.turn !== turnNumber) return;
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
