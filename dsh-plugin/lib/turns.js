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

import { chatKey, RECENT_LIMIT } from "./state.js";
import { ACK_EMOJI, MEDIA_ADAPTERS, MEDIA_LABELS, imageMediaType } from "./im.js";
import { chatPersonId, personRefs } from "./profiles.js";
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

/** 单行化不可信名字：换行会把一条载荷拆成两行，拼出假的指令行。 */
function oneLine(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

/**
 * 同一批里重名不同 ID 的显示名。命中者消息行 tag 追加发送者 ID 末 6 位，
 * 避免把「张三 A」说的话归到「张三 B」头上（spec 0031 §3）。
 * out / cmd 的 tag 本来就不看发送者名字（「我」「本人（@自己）」），不参与判定。
 */
function duplicateSenderNames(messages) {
  const idsByName = new Map();
  for (const m of (Array.isArray(messages) ? messages : [])) {
    if (!m || m.kind === "out" || m.kind === "cmd") continue;
    const id = String(m.sender_id || "");
    if (!id) continue;
    const name = oneLine(m.sender_name);
    if (!idsByName.has(name)) idsByName.set(name, new Set());
    idsByName.get(name).add(id);
  }
  const dup = new Set();
  for (const [name, ids] of idsByName) {
    if (ids.size > 1) dup.add(name);
  }
  return dup;
}

function formatMsgLine(m, mediaInfo = null, platform = "", dupNames = null) {
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
  // cmd = 本人在私聊里 @ 自己，对替身说的话（spec 0029），别当成客户消息。
  const who = m.kind === "cmd" ? "本人（@自己）" : (m.kind === "out" ? "我" : (oneLine(m.sender_name) || "对方"));
  // 点名是事实，不是判断：全量模式下 agent 要能一眼分清哪条是 @ 它。
  const notes = [];
  // 同名不同 ID 时标出 ID 末 6 位，归因才有唯一解。
  if (dupNames?.size && dupNames.has(oneLine(m.sender_name))) {
    const tail = String(m.sender_id || "").slice(-6);
    if (tail) notes.push(`ID ${tail}`);
  }
  if (m.kind === "mention") notes.push("@你");
  const tag = sanitizeUntrusted(notes.length ? `${who}（${notes.join("，")}）` : who);
  return `- [${m.ts || ""}] ${tag}: ${body}`;
}

/**
 * 记忆文件行：群两层（会话工作本 + 人物档案），单聊只有对方的人物档案一份（spec 0035）。
 * 插件只给路径与归属，不读正文、不判断内容。
 */
function memoryLine(bookPath, single = false) {
  if (!bookPath) return "";
  return single
    ? `人物档案：${bookPath}（单聊只维护这一份：这个人是谁、怎么说话、在意什么、历史结论；` +
      "只在这条私聊成立的备注也写这里，用「私聊：」开头）"
    : `会话工作本：${bookPath}（本会话的群规与工作要求；个人评价不写这里）`;
}

/** 旧私聊工作本：本版本起单聊只有人物档案；文件消失（并完归档）后这行自然消失。 */
function legacyLine(legacyPath, legacyHistory = "") {
  if (!legacyPath) return "";
  return `旧私聊工作本（待并入）：${legacyPath}（本版本起单聊只维护对方的人物档案；` +
    `把仍然成立的内容并进去，再把旧文件改名为 ${legacyHistory || legacyPath}，内容不丢）`;
}

/**
 * 人物档案指针块：`人物档案：` + 每人一行 `- <name> · <id> → <abs>`。
 * 插件只给路径与 ID，不读正文、不建文件、不解析画像；空 ID / 空路径跳过，
 * 全员都没有时返回空数组（people 为空不输出块）。单聊只给一份档案，不走这个块。
 */
function personLines(people) {
  const rows = [];
  for (const p of (Array.isArray(people) ? people : [])) {
    const id = oneLine(p?.id);
    const file = String(p?.path || "").trim();
    if (!id || !file) continue;
    const name = sanitizeUntrusted(oneLine(p?.name) || id.slice(0, 8));
    rows.push(`- ${name} · ${id} → ${file}`);
  }
  return rows.length ? ["人物档案：", ...rows] : [];
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
 * 一次唤醒 = 只追加本次新到的消息。新会话首轮带 `/cyber-im-avatar` 入口、
 * 平台/对象、chat_id、运行形态、记忆文件路径（群：会话工作本 + 人物档案；
 * 单聊：对方的人物档案一份）与媒体说明；已有会话后续唤醒只发本次消息行、
 * 这批发言人的档案行与还没并完的旧私聊工作本，不重复这些上下文——
 * 它们已经在同一 session 的历史里。文件正文由 agent 自己按路径读，
 * 插件不注入、不解析、不回写。
 */
export function buildWakePrompt(platform, chatName, chatId, messages, {
  bookPath = "", people = [], interrupted = false, firstTurn = false, mediaMap = null,
  wakeMode = "mention", resetMin = 0, kind = "group", single = false,
  legacyPath = "", legacyHistory = "",
} = {}) {
  const label = PLAT_LABEL[platform] || platform;
  const safeName = sanitizeUntrusted(chatName || chatId);
  const dupNames = duplicateSenderNames(messages);
  const lines = messages
    .slice()
    .sort((a, b) => (a.ts_epoch - b.ts_epoch))
    .map((m) => formatMsgLine(m, mediaFor(mediaMap, m.msg_id), platform, dupNames));
  const peopleBlock = personLines(people);
  const legacy = legacyLine(legacyPath, legacyHistory);

  // 本人指令：私聊里本人 @ 自己留给替身的话，不是客户消息，也不是已回复对面。
  const cmdNote = messages.some((m) => m.kind === "cmd")
    ? "【本人指令】带「本人（@自己）」的行是本人（你要替的人）在会话里 @ 自己留给你的话，" +
      "不是客户消息：按它执行或回答；除非指令明确要求对外回复、或按 skill 判断确有必要，" +
      "否则不要往会话里发消息。你的回复里不要 @ 本人自己——那会再次触发唤醒，形成回环。"
    : "";
  // 口径每轮都带一行：模式可以在会话中途切换，不能只靠首轮记住。
  // 全量提示只对群成立；私聊的 mention 是「只有 @ 才叫醒我」，得让 agent 知道缺上下文。
  const modeNote = (wakeMode === "all" && kind === "group")
    ? "（全量模式：非点名的群消息只看不回，要本人表态的写进当日日报等用户拍板；" +
      "标了「（@你）」的消息照常处理，该回就回。）"
    : ((wakeMode === "mention" && kind !== "group")
        ? "（只认 @ 模式：这通私聊只有对方 @ 你（或正文写 @你的名字）才唤醒；" +
          "其它消息没有转给你，需要上下文时按 skill 在线拉。）"
        : "");
  // 已有会话：只列本次新消息 + 这批发言人的档案路径。chat_id / 运行形态 /
  // 记忆文件行都已在本会话里，不再每一轮重复；旧私聊工作本待并入行除外（文件消失即停）。
  if (!firstTurn) {
    return [lines.join("\n"), legacy, ...peopleBlock, cmdNote, modeNote].filter(Boolean).join("\n");
  }

  const parts = ["/cyber-im-avatar"];
  if (interrupted) {
    parts.push("（上一轮被新消息打断，以最新上下文为准；未完成的事重新判断。）");
  }
  parts.push(`值守命中 · ${label} · ${safeName} · 新消息`);
  parts.push(`chat_id：${chatId}`);
  parts.push("运行形态：DSH 插件壳；监听、水位、唤醒由插件负责，不要挂监听，不要运行 listen_cli/bootstrap.py。");
  if (resetMin > 0) {
    parts.push(`会话：上一段会话闲置约 ${resetMin} 分钟（期间只保温一次），已自动重开；` +
      "更早上下文不在本会话，需要时按 skill 在线拉，别把新消息当成新客户。");
  }
  // 记忆文件：群两层（工作本 + 人物档案）；单聊一份（对方的人物档案）。
  const memory = memoryLine(bookPath, single);
  if (memory) parts.push(memory);
  if (peopleBlock.length) parts.push(...peopleBlock);
  if (legacy) parts.push(legacy);
  parts.push(...lines);
  if (cmdNote) parts.push(cmdNote);
  if (modeNote) parts.push(modeNote);
  if (mediaSize(mediaMap)) parts.push(MEDIA_HINT);
  parts.push(payloadNote(messages.length));
  parts.push(single
    ? "按 skill 处理这通私聊；记忆只改上面给出的那份人物档案，" +
      "不要写 state.json / env.json / media。"
    : "按 skill 处理这通会话；记忆只改上面给出的会话工作本与人物档案，" +
      "不要写 state.json / env.json / media。");
  return parts.join("\n");
}

/**
 * 人工开启值守时的开场载荷：不是命中唤醒，没有新消息也要把会话建起来。
 * 消息只当上下文，回不回由 agent 按 skill 判断；插件不在这里发任何东西。
 * 记忆文件与首轮唤醒同一套：群两层，单聊只有对方的人物档案一份。
 */
export function buildOpenPrompt(platform, chatName, chatId, messages, {
  bookPath = "", people = [], wakeMode = "mention", resetMin = 0, kind = "group",
  single = false, legacyPath = "", legacyHistory = "",
} = {}) {
  const label = PLAT_LABEL[platform] || platform;
  const safeName = sanitizeUntrusted(chatName || chatId);
  const dupNames = duplicateSenderNames(messages);
  const lines = messages
    .slice()
    .sort((a, b) => (a.ts_epoch - b.ts_epoch))
    .map((m) => formatMsgLine(m, null, platform, dupNames));
  const parts = ["/cyber-im-avatar"];
  parts.push(`值守已开启 · ${label} · ${safeName} · 会话开场（人工开启，不是新消息唤醒）`);
  parts.push(`chat_id：${chatId}`);
  parts.push("运行形态：DSH 插件壳；监听、水位、唤醒由插件负责，不要挂监听，不要运行 listen_cli/bootstrap.py。");
  if (resetMin > 0) {
    parts.push(`会话：上一段会话闲置约 ${resetMin} 分钟（期间只保温一次），已自动重开；` +
      "更早上下文不在本会话，需要时按 skill 在线拉。");
  }
  const memory = memoryLine(bookPath, single);
  if (memory) parts.push(memory);
  const peopleBlock = personLines(people);
  if (peopleBlock.length) parts.push(...peopleBlock);
  const legacy = legacyLine(legacyPath, legacyHistory);
  if (legacy) parts.push(legacy);
  if (lines.length) {
    parts.push(`最近上下文（最近 30 分钟，共 ${lines.length} 条）：`);
    parts.push(...lines);
    if (messages.some((m) => m.kind === "cmd")) {
      parts.push("（带「本人（@自己）」的行是本人对替身说的话，不是客户消息；按它执行即可，" +
        "回复里不要 @ 本人自己。）");
    }
  } else {
    parts.push("最近 30 分钟没有新消息。");
  }
  parts.push(kind === "group"
    ? (wakeMode === "all"
        ? "全量模式：非点名的群消息只看不回，要本人表态的写进当日日报；标了「（@你）」的照常处理。"
        : "只盯 @我：非点名的群消息不需要处理。")
    : (wakeMode === "all"
        ? "关注程度：全部消息（每条新消息都会唤醒）。"
        : "关注程度：只认 @（对方 @ 你（或正文写 @你的名字）才唤醒；其它消息不会转给你）。"));
  parts.push(single
    ? "这一轮是用户点「加入值守」触发的：先把上下文和这份人物档案读进来；" +
      "有该回的就按 skill 处理，**没有需要回的就不要往会话里发任何消息**。"
    : "这一轮是用户点「加入值守」触发的：先把上下文和两层文件读进来；" +
      "有该回的就按 skill 处理，**没有需要回的就不要往会话里发任何消息**。");
  if (lines.length) parts.push("上下文来自本地最近消息；更早的按 skill 在线拉，不要重发已经处理过的。");
  return parts.join("\n");
}

/**
 * 值守心跳：续上下文缓存 + 按 skill 规则归并记忆文件。不是客户消息，不能触发发送。
 * 只在已经消费过首轮载荷的会话里跑，所以不带 `/cyber-im-avatar` 与平台说明；
 * 只整理载荷列出的文件（群：工作本 + ≤3 份人物档案；单聊：那一份人物档案），不扫目录。
 */
export function buildWarmPrompt(platform, chatName, chatId, {
  bookPath = "", people = [], idleMin = 0, single = false,
  legacyPath = "", legacyHistory = "",
} = {}) {
  const label = PLAT_LABEL[platform] || platform;
  const safeName = sanitizeUntrusted(chatName || chatId);
  const parts = ["（值守心跳，不是客户消息）"];
  parts.push(`保温轮 · ${label} · ${safeName}` +
    (idleMin > 0 ? ` · 已闲置约 ${idleMin} 分钟` : ""));
  parts.push(`chat_id：${chatId}`);
  const memory = memoryLine(bookPath, single);
  if (memory) parts.push(memory);
  const peopleBlock = personLines(people);
  if (peopleBlock.length) parts.push(...peopleBlock);
  const legacy = legacyLine(legacyPath, legacyHistory);
  if (legacy) parts.push(legacy);
  parts.push("这一轮只做两件事：");
  parts.push("1. 续上下文缓存——不需要输出正文，也不需要汇报缓存状态。");
  const scope = single
    ? "这一类文件：上面那份人物档案"
    : (peopleBlock.length
        ? "这两类文件：会话工作本 + 上面列出的人物档案"
        : "这一类文件：会话工作本");
  parts.push(`2. 按 skill 的画像整理规则，只整理${scope}；该归并就归并` +
    "（合并重复、删一次性/已失效、把日期流水改写成结论）；没列出的文件不要动，不要扫目录；" +
    "不需要改就一个字都别改。");
  parts.push("边界：不要拉 IM 消息，不要给任何人发消息，不要调用发送类命令，" +
    "不要把这一轮当成客户来信回复。");
  parts.push("写不进去（沙箱拒绝）就跳过，不要重试、不要换路径；" +
    "最后用一句话说明「已归并」或「无需改动」，然后结束本轮。");
  return parts.join("\n");
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
    this.warming = new Map();
    // 回执去重：同一条消息在进程内只点一次；失败提醒每个平台每进程一次。
    this.acked = new Set();
    this.ackWarned = new Set();
    // 同一条 DSH 会话里已经下发过的人物档案：同一人不再每轮重复一份路径。
    // 换会话 / 重开 / 进程重启后从零开始（最多重复一次，不影响正确性）。
    this.seenPeople = new Map();
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

  /**
   * 这批消息对应的人物档案指针（确定性推导，不读正文、不建文件）：
   * 去重、跳过本人与 out、@我/待回优先，最多 cap 个；路径由 personPathFor 拼。
   * 私聊一条可判定的发言人都不剩时，用会话对端 ID 兜底（chatPersonId 决定平台形态）；
   * 两者都拿不到就只给会话工作本，不猜。
   */
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

  /**
   * 真正在跑的轮次：已被取消、正在收尾的不算。
   * 「加入 / 重开 / 切关注程度」要立刻起会话时用它判断，否则刚 cancel 的旧轮
   * 还挂在 active 里，open 会被误判成 running 而静默不开（spec 0028）。
   */
  busy(platform, chatId) {
    const handle = this.active.get(chatKey(platform, chatId));
    return !!handle && !handle.cancelled;
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

  /** 人工开启值守：立刻建会话/起一轮，不等新消息。在飞（未取消）则不打断，直接算成功。 */
  async open(chat, { reason = "join" } = {}) {
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
    return this._wake(chat, { interrupted: false, open: true, reason });
  }

  /** 开场轮取最近 30 分钟内、有正文的消息当上下文（不区分是否待回）。 */
  openMessages(chat, windowSec = 1800, limit = RECENT_LIMIT) {
    const floor = nowSec() - Math.max(60, Number(windowSec) || 1800);
    return (chat?.recent || [])
      .filter((m) => String(m.content || "").trim() && (Number(m.ts_epoch) || 0) >= floor)
      .sort((a, b) => (a.ts_epoch - b.ts_epoch))
      .slice(-limit);
  }

  async _wake(chat, { interrupted = false, batch = null, open = false } = {}) {
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
    const messages = opening ? this.openMessages(current) : this.wakeMessages(current, batch);
    if (!messages.length && !opening) return { ok: false, reason: "no_pending" };
    // 回执目标在启动前就定下来：之后即使被新消息打断，也不影响这一批已送出的消息。
    const ack = opening ? [] : this.ackTargets(current, messages);
    const old = this.active.get(key);
    if (old) {
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
      const prompt = opening
        ? buildOpenPrompt(current.platform, current.name, current.chat_id, messages, {
            bookPath: memory.path, single: memory.single, legacyPath, legacyHistory, people,
            wakeMode: current.wake_mode || "mention", resetMin, kind: current.kind,
          })
        : buildWakePrompt(current.platform, current.name, current.chat_id, messages, {
            bookPath: memory.path, single: memory.single, legacyPath, legacyHistory, people,
            interrupted, firstTurn, mediaMap: media.map,
            wakeMode: current.wake_mode || "mention", resetMin, kind: current.kind,
          });
      const message = await makeUserMessage(prompt, media.parts);
      handle.promptId = message.id;
      const effective = session.cwd || "";
      this.active.set(key, handle);
      handle.done = this.runTurn(handle, {
        chat: current, agent, sid, cwd: effective, message, ack,
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
        const prompt = buildWarmPrompt(current.platform, current.name, current.chat_id, {
          bookPath: memory.path, single: memory.single, legacyPath, legacyHistory, people, idleMin,
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

  runTurn(handle, { chat, agent, sid, cwd, message, warm = false, ack = [] }) {
    return new Promise((resolve) => {
      const key = chatKey(chat.platform, chat.chat_id);
      // 停滞超时（默认 600s）+ 单轮总上限兜底（默认 3600s，0 = 不限），见 spec 0034。
      const cfgDsh = this.state.data.config?.dsh || {};
      const timeoutSec = Math.max(120, Number(cfgDsh.timeout) || 600);
      const capSec = Math.max(0, Number(cfgDsh.turn_cap_sec ?? 3600) || 0);
      const startedAt = Date.now();
      let promptSeen = false;
      let lastTurnStart = null;
      let turnStarted = false;
      let turnNumber = null;
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
        if (handle.cancelled && !handle.timedOut) {
          const wasActive = this.active.get(key)?.turnId === handle.turnId;
          if (wasActive) {
            this.active.delete(key);
            if (!warm) {
              chat.wake.active = false;
              chat.wake.failed = false;
              chat.wake.turn_id = "";
              this.state.save();
            }
          }
          settle({ ok: false, reason: "cancelled" });
          return;
        }
        if (this.active.get(key)?.turnId !== handle.turnId) {
          settle(result);
          return;
        }
        this.active.delete(key);
        if (warm) {
          // 保温轮不是真实工作：只记自己的结果，不碰 session_turns / last_turn / wake，
          // 否则闲置时钟会被每小时一次心跳推后，3 小时重开永远不触发。
          chat.last_warm_at = nowSec();
          chat.last_warm_ok = !!result.ok;
          handle.lastOk = !!result.ok;
          handle.lastReason = result.ok ? "" : (result.reason || "turn_failed");
          handle.lastAt = nowSec();
          this.state.save();
          if (!result.ok) {
            this.logger.warn?.(`[im-standin] warm turn ${key}: ${handle.lastReason}`);
          }
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
          // 这个会话还在出事件 = 这轮还活着：重置停滞计时（spec 0034）。
          if (watchdog) watchdog.touch();
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
      // 会话已启动、载荷已送出：现在才点回执；失败不影响本轮。
      this.sendAck(chat, ack);
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
