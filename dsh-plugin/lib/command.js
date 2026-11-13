/**
 * command.js — 本人 @ 自己时的「启动值班」开关。
 *
 * 只做确定性识别，不碰 state / 网络：调用方决定何时查消息、何时开值班。
 * 关键词与「本人指令」共用 kind=cmd；带关键词的那条被插件消费，不再交给 agent。
 */
import { isMention } from "./im.js";

export const MAX_KEYWORD_CHARS = 20;
export const MAX_REPLY_CHARS = 200;
const CONTROL = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;
const SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
const AT_BOUNDARY = /[\s，。！？、；：,.!?;:）)\]】}"'“”‘’]/;

/** 设置页 / 配置 / 状态归一：去控制字符、压缩空白、最多 20 个字符。 */
export function normalizeKeyword(raw) {
  const text = String(raw == null ? "" : raw)
    .replace(CONTROL, " ")
    .replace(SPACES, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return Array.from(text).slice(0, MAX_KEYWORD_CHARS).join("");
}

/** 实际是否启用：开关打开且关键词非空。 */
export function commandEnabled(cfg) {
  const c = cfg?.command || cfg || {};
  return c.enabled !== false && !!normalizeKeyword(c.start_keyword);
}

/** 关键词超长（设置接口拒绝，不静默截断）；按 Unicode 字符数算。 */
export function keywordTooLong(raw) {
  const text = String(raw == null ? "" : raw)
    .replace(CONTROL, " ")
    .replace(SPACES, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).length > MAX_KEYWORD_CHARS;
}

/** 启动回执文案归一：去控制字符、压缩空白、最多 200 个字符；空串 = 不发。 */
export function normalizeReplyText(raw) {
  const text = String(raw == null ? "" : raw)
    .replace(CONTROL, " ")
    .replace(SPACES, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return Array.from(text).slice(0, MAX_REPLY_CHARS).join("");
}

/** 回执文案超长（设置接口拒绝，不静默截断）。 */
export function replyTooLong(raw) {
  const text = String(raw == null ? "" : raw)
    .replace(CONTROL, " ")
    .replace(SPACES, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).length > MAX_REPLY_CHARS;
}

/** 启动成功后要不要回一条：开关没关且文案非空。 */
export function replyEnabled(cfg) {
  const c = cfg?.command || cfg || {};
  return c.reply_enabled !== false && !!normalizeReplyText(c.reply_text);
}

/** 实际要发的回执文案；不需要发时返回空串。 */
export function replyText(cfg) {
  const c = cfg?.command || cfg || {};
  return replyEnabled(cfg) ? normalizeReplyText(c.reply_text) : "";
}

/** 去掉 @ 自己留下的占位符 / 显示名，只留下正文给关键词匹配。 */
export function stripMentions(content, selfNames = []) {
  let text = String(content == null ? "" : content);
  text = text.replace(/@_user_\d+/g, " ");
  for (const name of (Array.isArray(selfNames) ? selfNames : [])) {
    const n = String(name || "").trim();
    if (!n) continue;
    for (const needle of ["@" + n, "＠" + n]) {
      let i = text.indexOf(needle);
      while (i >= 0) {
        const before = i === 0 ? "" : text[i - 1];
        const after = text[i + needle.length] || "";
        // 与 isMention 用同一套边界：邮箱 a@我.com 里的 @我 不是 mention。
        if ((!before || AT_BOUNDARY.test(before)) && (!after || AT_BOUNDARY.test(after))) {
          text = text.slice(0, i) + " " + text.slice(i + needle.length);
        }
        i = text.indexOf(needle, i + 1);
      }
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 一条消息是不是「启动值守」指令：本人发送 + @ 到本人 + 去掉 mention 后含关键词。
 * 只认 ASCII 大小写不敏感；中文与符号按原样包含匹配。
 */
export function isStartCommand(msg, {
  selfId = "", selfNames = [], keyword = "",
} = {}) {
  const kw = normalizeKeyword(keyword);
  if (!msg || !kw) return false;
  if (!selfId || String(msg.sender_id || "") !== String(selfId)) return false;
  if (!isMention(msg, selfId, selfNames)) return false;
  const body = stripMentions(msg.content, selfNames).toLowerCase();
  return body.includes(kw.toLowerCase());
}

/** 搜索到的原始消息 → 与 poller.process() 同形的 recent 行（开场上下文用）。 */
export function commandRow(msg) {
  return {
    msg_id: String(msg?.msg_id || ""),
    sender_id: String(msg?.sender_id || ""),
    sender_name: String(msg?.sender_name || ""),
    content: String(msg?.content || ""),
    ts: String(msg?.ts || ""),
    ts_epoch: Number(msg?.ts_epoch) || 0,
    kind: "cmd",
    state: "new",
    msg_type: String(msg?.msg_type || ""),
    app_link: String(msg?.app_link || ""),
    media_id: String(msg?.media_id || ""),
    media_paths: Array.isArray(msg?.media_paths) ? msg.media_paths : [],
  };
}

export const COMMAND_RESULTS = ["", "starting", "started", "already", "blocked", "failed"];
