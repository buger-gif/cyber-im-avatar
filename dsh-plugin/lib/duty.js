/**
 * duty.js — 值守分诊的确定性状态机。
 *
 * agent 只写 duty/decisions/<event_id>.json；这里校验、执行、清理。
 * 不做语义判断：watch / trial / ignore 是 agent 的决定，插件只守硬门
 *（mention、群人数、值守上限、配额、trial 开关）。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { chatKey } from "./state.js";

const ACTIONS = new Set(["watch", "trial", "ignore"]);
const REVIEW_ACTIONS = new Set(["watch", "ignore"]);

export function nowSec() {
  return Date.now() / 1000;
}

export function eventId() {
  return "d-" + crypto.randomBytes(6).toString("hex");
}

/** 插件安装/首次启动时写入的初始值守方针；agent 可直接改，插件只补缺、不覆盖。 */
export const DEFAULT_POLICY = `# 值守方针

> 这是插件安装时写入的初始版本，值守台 agent 可以按用户偏好直接改。
> 插件只在本文件缺失或为空时补一份，不解析、不覆盖已有内容。

## 值得值守

- 工作项目群、客户群：有人点名叫你、有具体请求，群成员不超过 10 人。
- 熟悉的同事 / 客户，问题明确、需要你本人表态或排期。

## 先试用

- 新群有工作迹象，但信息不足；先看一段时间再决定。
- 当前 \`duty.trial_hours=0\` 时不要选 trial，直接 ignore 等新的个人 @。

## 不盯

- 营销、告警、临时聚会、纯寒暄；\`@所有人\` 不算个人 @。
- 群成员 > 10 人或人数未知（自动路径只能 ignore）。
- 已屏蔽、平台判不了个人 @（如企微）。

## 硬约束

- 新监听群一律只盯 @我，不开全部消息。
- 分诊轮不向群里发消息；不替用户答应钱、合同、承诺或对外发言。
- 不确定就 ignore；等新的个人 @ 再判，不猜。
`;
export function dutyDir(state) {
  return path.join(state.dir, "duty");
}

export function decisionsDir(state) {
  return path.join(dutyDir(state), "decisions");
}

export function ensureDutyDir(state) {
  const dir = dutyDir(state);
  fs.mkdirSync(decisionsDir(state), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
  try { fs.chmodSync(decisionsDir(state), 0o700); } catch { /* best effort */ }
  const policy = path.join(dir, "policy.md");
  let existing = null;
  try { existing = fs.lstatSync(policy); } catch { existing = null; }
  // 只在缺失或空文件时补初始版本；已有内容（agent/用户维护）绝不覆盖。
  if (!existing || (existing.isFile() && existing.size === 0)) {
    try {
      fs.writeFileSync(policy, DEFAULT_POLICY, { mode: 0o600 });
      try { fs.chmodSync(policy, 0o600); } catch { /* best effort */ }
    } catch { /* best effort */ }
  }
  return dir;
}

export function decisionPath(state, id) {
  return path.join(decisionsDir(state), `${id}.json`);
}

export function normalizeDuty(chat, out) {
  if (!chat) return out;
  const d = out || chat.duty || {};
  chat.duty = {
    state: ["none", "queued", "triaging", "watch", "trial", "reviewing", "ignore", "failed"]
      .includes(d.state) ? d.state : "none",
    trigger: ["added", "mentioned", "manual", "review", "sweep"].includes(d.trigger) ? d.trigger : "",
    event_id: String(d.event_id || ""),
    event_at: Number(d.event_at) || 0,
    triaged_at: Number(d.triaged_at) || 0,
    decided_at: Number(d.decided_at) || 0,
    by: String(d.by || ""),
    reason: String(d.reason || "").slice(0, 160),
    confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0)),
    review_at: Number(d.review_at) || 0,
    attempts: Math.max(0, Number(d.attempts) || 0),
    error: String(d.error || "").slice(0, 160),
    sweep_epoch: Number(d.sweep_epoch) || 0,
    member_count: Math.max(0, Number(d.member_count) || 0),
  };
  return chat.duty;
}

/** 新事件：保留 sweep_epoch / member_count；其余判断字段重置。 */
export function newEvent(chat, trigger, { id = "", at = 0 } = {}) {
  const prev = normalizeDuty(chat);
  const event = {
    state: "queued",
    trigger,
    event_id: id || eventId(),
    event_at: at || nowSec(),
    triaged_at: 0,
    decided_at: 0,
    by: "",
    reason: "",
    confidence: 0,
    review_at: 0,
    attempts: 0,
    error: "",
    sweep_epoch: prev.sweep_epoch || 0,
    member_count: prev.member_count || 0,
  };
  chat.duty = event;
  return event;
}

/** 复核事件：不动 triaged_at（不占配额），只换 event_id / event_at。 */
export function newReviewEvent(chat, at = 0) {
  const prev = normalizeDuty(chat);
  chat.duty = {
    ...prev,
    state: "reviewing",
    trigger: "review",
    event_id: eventId(),
    event_at: at || nowSec(),
    decided_at: 0,
    by: "",
    reason: "",
    confidence: 0,
    // 复核保留 attempts，达到 2 次即自动收口；不清零可避免每 tick 无限重试。
    error: "",
  };
  return chat.duty;
}

export function quotaUsed(state, td = nowSec()) {
  const day = new Date(td * 1000);
  const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();
  let n = 0;
  for (const chat of state.listChats()) {
    const t = Number(chat.duty?.triaged_at) || 0;
    if (!t) continue;
    const x = new Date(t * 1000);
    if (x.getFullYear() === y && x.getMonth() === m && x.getDate() === d) n += 1;
  }
  return n;
}

export function watchGroups(state) {
  return state.listChats().filter((c) => c.kind === "group" && c.watching).length;
}

export function publicDuty(chat) {
  return chat?.duty ? { ...chat.duty } : null;
}

function assertFile(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile()) throw new Error("not_file");
  if (st.size > 16 * 1024) throw new Error("too_large");
}

export function readDecision(file, expected) {
  assertFile(file);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid" };
  if (Number(raw.version || 1) !== 1) return { ok: false, error: "invalid_version" };
  if (String(raw.decision_id || "") !== String(expected.event_id || "")) {
    return { ok: false, error: "decision_id_mismatch" };
  }
  if (String(raw.platform || "") !== String(expected.platform || "") ||
      String(raw.chat_id || "") !== String(expected.chat_id || "")) {
    return { ok: false, error: "chat_mismatch" };
  }
  const action = String(raw.action || "");
  if (!ACTIONS.has(action)) return { ok: false, error: "invalid_action" };
  const review = expected.trigger === "review";
  if (review && !REVIEW_ACTIONS.has(action)) return { ok: false, error: "review_action_invalid" };
  if (raw.mode != null && String(raw.mode) !== "mention") {
    return { ok: false, error: "all_disabled" };
  }
  const reason = String(raw.reason || "").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 160);
  if (!reason) return { ok: false, error: "missing_reason" };
  const confidence = raw.confidence == null ? 0.5 : Number(raw.confidence);
  const reviewAt = raw.review_at == null ? 0 : Number(raw.review_at);
  return {
    ok: true,
    decision: {
      action, mode: "mention", reason,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
      review_at: Number.isFinite(reviewAt) ? reviewAt : 0,
    },
  };
}

function clearPending(chat) {
  for (const m of chat.recent || []) {
    if (m.kind === "dm" || m.kind === "mention" || m.kind === "service") {
      if (m.state === "new" || m.state === "opened") {
        m.state = "ignored";
        m.content = "";
      }
    }
  }
}

/**
 * 应用 agent 决策。只处理 agent 路径；用户手动入口不经过这里。
 * 返回 {ok, action, error}，不抛异常；状态已写回 chat / state。
 */
export async function applyDecision({ state, chat, decision, turns = null, profiles = null, cfg = null, im = null, contextMessages = [] }) {
  const c = cfg || state.data.config?.duty || {};
  const d = chat?.duty;
  if (!chat || !d) return { ok: false, error: "missing_chat" };
  const action = String(decision?.action || "");
  if (!ACTIONS.has(action)) return { ok: false, error: "invalid_action" };
  if (action === "trial" && !(Number(c.trial_hours) > 0)) {
    d.state = "failed"; d.error = "trial_disabled"; d.by = "agent"; d.decided_at = nowSec();
    state.save();
    return { ok: false, error: "trial_disabled" };
  }
  const firstOpen = !chat.watching;
  if (action !== "ignore" && firstOpen) {
    if (im?.adapter && !im.adapter(chat.platform).canMention) {
      d.state = "failed"; d.error = "mention_unavailable"; d.by = "agent"; d.decided_at = nowSec();
      state.save();
      return { ok: false, error: "mention_unavailable" };
    }
    if (Number(c.max_groups) > 0 && watchGroups(state) >= Number(c.max_groups)) {
      d.state = "failed"; d.error = "watch_cap"; d.by = "agent"; d.decided_at = nowSec();
      state.save();
      return { ok: false, error: "watch_cap" };
    }
    const limit = Number(c.max_group_members) || 0;
    if (limit > 0) {
      const count = Number(d.member_count) || 0;
      if (!count) {
        d.state = "failed"; d.error = "member_unknown"; d.by = "agent"; d.decided_at = nowSec();
        state.save();
        return { ok: false, error: "member_unknown" };
      }
      if (count > limit) {
        d.state = "failed"; d.error = "group_too_large"; d.by = "agent"; d.decided_at = nowSec();
        state.save();
        return { ok: false, error: "group_too_large" };
      }
    }
  }
  const now = nowSec();
  if (action === "ignore") {
    chat.watching = false;
    chat.timer = -1;
    d.state = "ignore";
    d.by = "agent";
    d.decided_at = now;
    d.reason = String(decision.reason || "").slice(0, 160);
    d.confidence = Number(decision.confidence) || 0;
    d.review_at = 0;
    d.error = "";
    d.attempts = 0;
    d.sweep_epoch = Math.max(Number(d.sweep_epoch) || 0, Number(chat.last_epoch) || 0);
    clearPending(chat);
    if (turns?.cancel) turns.cancel(chat.platform, chat.chat_id, "duty_ignore");
    state.save();
    try { fs.unlinkSync(decisionPath(state, d.event_id)); } catch { /* best effort */ }
    return { ok: true, action };
  }
  chat.watching = true;
  chat.target = true;
  chat.timer = 1;
  chat.wake_mode = "mention";
  if (!chat.send_mode) chat.send_mode = state.data.config.send_mode_default || "draft";
  d.state = action === "trial" ? "trial" : "watch";
  d.by = "agent";
  d.decided_at = now;
  d.reason = String(decision.reason || "").slice(0, 160);
  d.confidence = Number(decision.confidence) || 0;
  d.review_at = action === "trial" ? (Number(decision.review_at) || now + Number(c.trial_hours) * 3600) : 0;
  if (d.review_at) {
    d.review_at = Math.max(now + 3600, Math.min(d.review_at, now + Number(c.trial_hours) * 3600));
  }
  d.error = "";
  d.attempts = 0;
  // 首次开监听时，探针已经把这批消息交给接手轮；把正常水位推到探针最新，
  // 避免下一轮快车道把同一批 @ 再唤醒一次。sweep 探针本身仍是只读的。
  if (firstOpen && Array.isArray(contextMessages) && contextMessages.length) {
    let newest = null;
    for (const m of contextMessages) {
      const e = Number(m.ts_epoch) || 0;
      if (!newest || e > newest.epoch) newest = { epoch: e, ts: String(m.ts || ""), id: String(m.msg_id || "") };
    }
    if (newest && newest.epoch > (Number(chat.last_epoch) || 0)) {
      chat.last_epoch = newest.epoch;
      chat.last_ts = newest.ts;
      chat.last_msg_id = newest.id;
    }
  }
  d.sweep_epoch = Math.max(Number(d.sweep_epoch) || 0, Number(chat.last_epoch) || 0);
  state.save();
  try { fs.unlinkSync(decisionPath(state, d.event_id)); } catch { /* best effort */ }
  if (profiles?.ensureMemory) {
    try { profiles.ensureMemory(chat.platform, chat, ""); } catch { /* best effort */ }
  }
  if (firstOpen && turns?.open) {
    try {
      await turns.open(chat, { reason: "duty", dutyContext: {
        action, reason: d.reason, messages: contextMessages || [],
      } });
    } catch { /* opening failure does not roll back watching */ }
  }
  return { ok: true, action };
}

/** 启动前先看文件：有合法决策就直接应用，不重复起 turn。 */
export async function consumeDecision({ state, chat, turns = null, profiles = null, im = null, contextMessages = [] }) {
  const d = chat?.duty;
  if (!d?.event_id) return { ok: false, error: "no_event" };
  const file = decisionPath(state, d.event_id);
  if (!fs.existsSync(file)) return { ok: false, error: "no_decision" };
  let r;
  try {
    r = readDecision(file, {
      event_id: d.event_id, platform: chat.platform, chat_id: chat.chat_id, trigger: d.trigger,
    });
  } catch (e) {
    r = { ok: false, error: "invalid_file" };
  }
  if (!r.ok) {
    d.state = d.trigger === "review" ? "trial" : "failed";
    d.error = r.error;
    d.attempts = Math.max(1, Number(d.attempts) || 0);
    state.save();
    return { ok: false, error: r.error };
  }
  const applied = await applyDecision({ state, chat, decision: r.decision, turns, profiles, im, contextMessages });
  return applied;
}

export function cleanupDecisions(state, days = 7) {
  const dir = decisionsDir(state);
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  const floor = nowSec() - Math.max(0, Number(days) || 0) * 86400;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.mtimeMs / 1000 >= floor) continue;
      fs.unlinkSync(file);
      removed += 1;
    } catch { /* best effort */ }
  }
  return removed;
}

export function cleanupRecords(state, cfg = null) {
  const c = cfg || state.data.config?.duty || {};
  const days = Math.max(0, Number(c.record_keep_days) || 0);
  if (!days) return 0;
  const floor = nowSec() - days * 86400;
  let n = 0;
  for (const chat of state.listChats()) {
    const d = chat.duty;
    if (!d || !["ignore", "failed"].includes(d.state)) continue;
    if (!d.decided_at || d.decided_at >= floor) continue;
    d.state = "none";
    d.trigger = "";
    d.event_id = "";
    d.event_at = 0;
    d.triaged_at = 0;
    d.decided_at = 0;
    d.by = "";
    d.reason = "";
    d.confidence = 0;
    d.review_at = 0;
    d.attempts = 0;
    d.error = "";
    // sweep_epoch / member_count 保留：它们是会话属性，不是一次判断。
    n += 1;
  }
  if (n) state.save();
  return n;
}

export function dutyCounts(state) {
  const out = { queued: 0, triaging: 0, trial: 0, failed: 0, ignore: 0, watch: 0,
    reviewing: 0, quota_used: quotaUsed(state), watch_groups: watchGroups(state) };
  for (const chat of state.listChats()) {
    const st = chat.duty?.state || "none";
    if (st in out) out[st] += 1;
  }
  return out;
}

export function keyOf(chat) {
  return chatKey(chat.platform, chat.chat_id);
}
