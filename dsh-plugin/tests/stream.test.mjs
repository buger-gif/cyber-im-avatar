import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State } from "../lib/state.js";
import { Poller } from "../lib/poller.js";

function nowSec() { return Date.now() / 1000; }

function msg(id, epoch, extra = {}) {
  return {
    msg_id: id, sender_id: "ou_other", sender_name: "对方",
    content: `正文-${id}`, ts: `t-${epoch}`, ts_epoch: epoch,
    msg_type: "text", mentions: [], ...extra,
  };
}

class StreamAdapter {
  constructor() {
    this.messages = [];
    this.chats = [];
    this.calls = [];
    this.fetchCalls = 0;
    this.sinceCalls = [];
    this.streamCalls = [];
    this.listCalls = 0;
    this.listOk = true;
    this.memberCount = 8;
    this.memberKnown = true;
    this.sent = [];
    this.sendOk = true;
    this.self = { ok: true, self_id: "ou_me", name: "我", detail: "" };
    this.supportsMessageStream = true;
    this.supportsSince = true;
    this.canMention = true;
    // 流 / 区间读的返回值，由用例注入。
    this.streamResult = { ok: true, items: [], complete: true, total: 0 };
    this.sinceResult = () => ({ ok: true, messages: [], complete: true });
    this.atMe = [];
    this.atMeCalls = 0;
    this.atMeArgs = [];
  }
  async whoami() { return this.self; }
  async resolveQuotes() {}
  async fetchMessages(chatId, { limit = 10 } = {}) {
    this.fetchCalls += 1;
    this.calls.push({ chatId, limit });
    return { ok: true, messages: this.messages.slice(0, limit) };
  }
  async fetchSince(chatId, opts = {}) {
    this.sinceCalls.push({ chatId, ...opts });
    return this.sinceResult(chatId, opts);
  }
  async searchMessages(opts = {}) {
    this.streamCalls.push(opts);
    return this.streamResult;
  }
  async searchAtMe(opts = {}) {
    this.atMeCalls += 1;
    this.atMeArgs.push(opts);
    return { ok: true, items: this.atMe };
  }
  async searchSelfMentions() { return { ok: true, items: [] }; }
  async listChats(limit, opts) {
    this.listCalls += 1;
    return this.listOk ? { ok: true, items: this.chats } : { ok: false, items: [], error: "auth expired" };
  }
  async chatMembers() { return { ok: true, known: this.memberKnown, count: this.memberCount }; }
  async sendText(chatId, text) {
    this.sent.push({ chatId, text });
    return this.sendOk ? { ok: true, message_id: "om_sent" } : { ok: false, error: "send failed" };
  }
  async search() { return { ok: true, items: [] }; }
  async searchChats() { return { ok: true, items: [] }; }
}

class FakeTurns {
  constructor() {
    this.active = new Set();
    this.wakes = [];
    this.opens = [];
    this.failNext = 0;
  }
  hostReady() { return true; }
  isActive(platform, chatId) { return this.active.has(`${platform}:${chatId}`); }
  busy(platform, chatId) { return this.active.has(`${platform}:${chatId}`); }
  async wake(chat, opts = {}) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      chat.wake = { ...(chat.wake || {}), failed: true };
      return { ok: false, reason: "host_unavailable" };
    }
    this.wakes.push({ chat, opts });
    return { ok: true, started: true, turn_id: `turn-${this.wakes.length}` };
  }
  async open(chat, opts = {}) { this.opens.push({ chat, opts }); return { ok: true, started: true }; }
  openMessages(chat) { return (chat.recent || []).filter((m) => String(m.content || "").trim()); }
  async warm() { return { ok: true, started: true }; }
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-stream-"));
  const state = new State(dir);
  state.load();
  state.data.config.poll.refresh_chatlist = false;
  state.data.config.poll.cooldown_sec = 0;
  const adapter = new StreamAdapter();
  const im = { adapter: () => adapter };
  const poller = new Poller({ state, im, logger: { warn() {}, info() {}, error() {} } });
  const turns = new FakeTurns();
  poller.turns = turns;
  return { state, poller, adapter, turns };
}

/** 已基线：有 last_epoch / poll_since / last_sync 的会话，快车道直接走流。 */
function watched(state, platform, chatId, kind, extra = {}) {
  const chat = state.ensureChat(platform, chatId, { name: chatId, kind });
  chat.watching = true;
  chat.last_sync = nowSec() - 30;
  chat.last_epoch = nowSec() - 60;
  chat.last_ts = "t-1";
  chat.poll_since = nowSec() - 60;
  Object.assign(chat, extra);
  return chat;
}

test("fast lane is one stream, plus one context read per wake", async () => {
  const { state, poller, adapter, turns } = setup();
  const dm = watched(state, "feishu", "oc_dm", "p2p");
  const group = watched(state, "feishu", "oc_grp", "group", { timer: 1 });
  const t = nowSec() - 5;
  adapter.streamResult = {
    ok: true, complete: true,
    items: [
      msg("s1", t, { chat_id: "oc_dm" }),
      msg("s2", t, { chat_id: "oc_grp", content: "@我 看下", mentions: [{ id: { open_id: "ou_me" } }] }),
    ],
  };
  const r = await poller.fastCycle();
  assert.equal(adapter.streamCalls.length, 1, "只发一条流");
  assert.equal(adapter.fetchCalls, 2, "只有要唤醒的两个会话各补一次上下文");
  assert.equal(adapter.sinceCalls.length, 0);
  assert.equal(r.stream.ok, true);
  assert.equal(r.stream.scanned, 2);
  assert.equal(r.stream.matched, 2);
  assert.equal(turns.wakes.length, 2);
  assert.ok(dm.recent.some((m) => m.msg_id === "s1"));
  assert.equal(group.recent.find((m) => m.msg_id === "s2").kind, "mention");
  assert.ok(state.data.runtime.stream.since > 0);
  assert.equal(adapter.streamCalls[0].chatIds.length, 2);
  assert.ok(adapter.streamCalls[0].start instanceof Date);
});

test("the same message seen again is not delivered twice", async () => {
  const { state, poller, adapter, turns } = setup();
  watched(state, "feishu", "oc_dm", "p2p");
  const t = nowSec() - 5;
  adapter.streamResult = { ok: true, complete: true, items: [msg("s1", t, { chat_id: "oc_dm" })] };
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 1);
  // 同一窗口重读（游标只按分钟推进，平台会重叠返回）
  adapter.streamResult = { ok: true, complete: true, items: [msg("s1", t, { chat_id: "oc_dm" })] };
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 1, "重读不重复投递");
  const chat = state.getChat("feishu", "oc_dm");
  assert.equal(chat.recent.filter((m) => m.msg_id === "s1").length, 1);
  assert.ok(chat.recent.find((m) => m.msg_id === "s1").delivered_at > 0);
});

test("a failed wake stays pending and is retried with the same batch", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = watched(state, "feishu", "oc_dm", "p2p");
  adapter.streamResult = { ok: true, complete: true, items: [msg("s1", nowSec() - 5, { chat_id: "oc_dm" })] };
  turns.failNext = 1;
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 0);
  assert.equal(chat.recent.find((m) => m.msg_id === "s1").delivered_at, 0, "失败不落投递标记");
  assert.equal(chat.wake.failed, true);

  // 下一轮流里没有新消息，也要把积压补投出去。
  adapter.streamResult = { ok: true, complete: true, items: [] };
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 1);
  assert.deepEqual(turns.wakes[0].opts.batch.map((m) => m.msg_id), ["s1"]);
  assert.ok(chat.recent.find((m) => m.msg_id === "s1").delivered_at > 0);
});

test("a truncated stream still guarantees @ through one at-me search", async () => {
  const { state, poller, adapter, turns } = setup();
  watched(state, "feishu", "oc_grp", "group", { timer: 1 });
  adapter.streamResult = { ok: true, complete: false, items: [] };
  adapter.atMe = [msg("a1", nowSec() - 3, {
    chat_id: "oc_grp", content: "@我 在吗", mentions: [{ id: { open_id: "ou_me" } }],
  })];
  const r = await poller.fastCycle();
  assert.equal(adapter.atMeCalls, 1);
  assert.equal(adapter.atMeArgs[0].chatIds.length, 1);
  assert.equal(r.stream.complete, false);
  assert.ok(state.data.runtime.stream.truncated_at > 0);
  assert.equal(turns.wakes.length, 1);
  assert.equal(turns.wakes[0].opts.batch[0].msg_id, "a1");
});

test("stream failure degrades to per-chat interval reads and keeps the cursor", async () => {
  const { state, poller, adapter, turns } = setup();
  watched(state, "feishu", "oc_dm", "p2p");
  state.data.runtime.stream = { since: 1700000000, at: 0, ok: true, error: "" };
  adapter.streamResult = { ok: false, error: "search down" };
  adapter.sinceResult = () => ({ ok: true, complete: true, messages: [msg("b1", nowSec() - 4)] });
  const r = await poller.fastCycle();
  assert.equal(r.stream.ok, false);
  assert.equal(adapter.sinceCalls.length, 1, "失败这一轮逐会话补读");
  assert.equal(turns.wakes.length, 1);
  assert.equal(state.data.runtime.stream.since, 1700000000, "失败不动游标");
  assert.equal(state.data.runtime.stream.ok, false);
  assert.match(state.data.runtime.stream.error, /search down/);
  assert.ok(state.getChat("feishu", "oc_dm").last_error === "");
});

test("an incomplete interval read records a gap and does not replay the backlog", async () => {
  const { state, poller, adapter } = setup();
  const chat = watched(state, "feishu", "oc_grp", "group", { timer: 1 });
  const since = chat.poll_since;
  adapter.sinceResult = () => ({ ok: true, complete: false, messages: [] });
  const r = await poller.pollChat("feishu", "oc_grp", { force: true, source: "verify" });
  assert.equal(r.fetched, true);
  assert.equal(chat.gap.source, "backlog");
  assert.equal(chat.gap.from, since);
  assert.ok(chat.gap.at > 0);
  assert.ok(chat.poll_since >= chat.gap.at - 1, "不完整就把游标推到 now，不回放");
});

test("slow lane reconciles one interval read and delivers what the stream missed", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = watched(state, "feishu", "oc_dm", "p2p");
  chat.verified_at = 0;
  adapter.sinceResult = () => ({ ok: true, complete: true, messages: [msg("r1", nowSec() - 3)] });
  const r = await poller.cycle({ force: true });
  assert.equal(adapter.sinceCalls.length, 1);
  assert.equal(r.verified, 1);
  assert.ok(chat.verified_at > 0);
  assert.equal(turns.wakes.length, 1, "对账补回的消息照样投递");
  assert.equal(turns.wakes[0].opts.batch[0].msg_id, "r1");
});

test("a 10-minute floor caps the interval read and leaves a gap for the rest", async () => {
  const { state, poller, adapter } = setup();
  const chat = watched(state, "feishu", "oc_dm", "p2p");
  chat.poll_since = nowSec() - 3600;
  adapter.sinceResult = () => ({ ok: true, complete: true, messages: [] });
  await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(chat.gap.source, "backlog");
  assert.ok(chat.gap.to >= nowSec() - 600 - 5);
  assert.ok(adapter.sinceCalls[0].since >= nowSec() - 600 - 5);
});

test("chats without a stream keep the per-chat path", async () => {
  const { state, poller, adapter } = setup();
  adapter.supportsMessageStream = false;
  watched(state, "feishu", "oc_dm", "p2p");
  adapter.sinceResult = () => ({ ok: true, complete: true, messages: [msg("m1", nowSec() - 5)] });
  await poller.fastCycle();
  assert.equal(adapter.streamCalls.length, 0);
  assert.equal(adapter.sinceCalls.length, 1, "没有流就退回逐会话区间读");
  assert.equal(adapter.fetchCalls, 0);
});
test("stream wake enriches quote and media keys from one context read", async () => {
  const { state, poller, adapter, turns } = setup();
  watched(state, "feishu", "oc_dm", "p2p");
  adapter.streamResult = { ok: true, complete: true, items: [msg("q1", nowSec() - 5, { chat_id: "oc_dm" })] };
  adapter.messages = [{
    ...msg("q1", nowSec() - 5),
    reply_to: "om_parent",
    quote: { msg_id: "om_parent", sender_id: "ou_other", sender_name: "对方", content: "原话", ts: "t-6" },
    media_id: "img_v2_demo",
  }];
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 1);
  const row = turns.wakes[0].opts.batch[0];
  assert.equal(row.reply_to, "om_parent");
  assert.equal(row.quote.content, "原话");
  assert.equal(row.media_id, "img_v2_demo");
});

test("@all, unwatched chats and blocked chats never wake from the stream", async () => {
  const { state, poller, adapter, turns } = setup();
  const group = watched(state, "feishu", "oc_grp", "group", { timer: 1 });
  const blocked = watched(state, "feishu", "oc_blocked", "p2p", { blocked: true });
  const unwatched = watched(state, "feishu", "oc_unwatched", "p2p", { watching: false });
  adapter.streamResult = {
    ok: true, complete: true,
    items: [
      msg("all1", nowSec() - 3, { chat_id: "oc_grp", content: "@所有人 通知", mentions: [{ id: { open_id: "all" } }] }),
      msg("un1", nowSec() - 3, { chat_id: "oc_unwatched" }),
      msg("blk1", nowSec() - 3, { chat_id: "oc_blocked" }),
    ],
  };
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 0);
  assert.equal(group.recent.find((m) => m.msg_id === "all1").kind, "fyi");
  assert.equal(group.recent.find((m) => m.msg_id === "all1").state, "ignored");
  assert.equal(unwatched.recent.length, 0, "未值守会话不落消息");
  assert.equal(blocked.recent.length, 0);
});

test("a pure drain does not interrupt an in-flight turn", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = watched(state, "feishu", "oc_dm", "p2p");
  adapter.streamResult = { ok: true, complete: true, items: [msg("d1", nowSec() - 5, { chat_id: "oc_dm" })] };
  turns.failNext = 1;
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 0);
  chat.last_wake_at = nowSec(); // 这批消息都在上次唤醒之前
  turns.active.add("feishu:oc_dm");
  adapter.streamResult = { ok: true, complete: true, items: [] };
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 1);
  assert.equal(turns.wakes[0].opts.interrupted, false);
});

test("reconciliation counts what the stream missed", async () => {
  const { state, poller, adapter } = setup();
  watched(state, "feishu", "oc_dm", "p2p");
  state.data.runtime.stream = { since: 1, at: 0, ok: true, error: "", missed: 0 };
  adapter.sinceResult = () => ({ ok: true, complete: true, messages: [msg("r1", nowSec() - 3)] });
  await poller.cycle({ force: true });
  assert.equal(state.data.runtime.stream.missed, 1);
});

test("more than 100 watched chats are streamed in two batches", async () => {
  const { state, poller, adapter, turns } = setup();
  for (let i = 0; i < 101; i += 1) watched(state, "feishu", `oc_c${i}`, "p2p");
  const calls = [];
  adapter.searchMessages = async (opts) => {
    calls.push(opts);
    return {
      ok: true, complete: true,
      items: opts.chatIds.includes("oc_c100")
        ? [msg("last1", nowSec() - 3, { chat_id: "oc_c100" })] : [],
    };
  };
  await poller.fastCycle();
  assert.equal(calls.length, 2, "101 个会话分两批");
  assert.equal(calls[0].chatIds.length, 100);
  assert.equal(calls[1].chatIds.length, 1);
  assert.equal(turns.wakes.length, 1);
  assert.equal(turns.wakes[0].chat.chat_id, "oc_c100");
});

test("a healthy stream tick keeps the reconciliation counter", async () => {
  const { state, poller, adapter } = setup();
  watched(state, "feishu", "oc_dm", "p2p");
  state.data.runtime.stream = { since: 1, at: 0, ok: true, error: "", missed: 0 };
  adapter.sinceResult = () => ({ ok: true, complete: true, messages: [msg("r1", nowSec() - 3)] });
  await poller.cycle({ force: true });
  assert.equal(state.data.runtime.stream.missed, 1);
  adapter.streamResult = { ok: true, complete: true, items: [] };
  await poller.fastCycle();
  assert.equal(state.data.runtime.stream.missed, 1, "下一跳不能把对账计数清零");
});

test("an interval read processes every message in the window, not just the first 10", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = watched(state, "feishu", "oc_grp", "group", { timer: 1 });
  const base = nowSec() - 60;
  const rows = [];
  for (let i = 0; i < 12; i += 1) {
    const at = base + i;
    rows.push(msg(`i${i}`, at, i === 1
      ? { content: "@我 在吗", mentions: [{ id: { open_id: "ou_me" } }] } : {}));
  }
  adapter.sinceResult = () => ({ ok: true, complete: true, messages: rows.reverse() });
  await poller.pollChat("feishu", "oc_grp", { force: true, source: "verify" });
  assert.equal(turns.wakes.length, 1);
  assert.deepEqual(turns.wakes[0].opts.batch.map((m) => m.msg_id), ["i1"]);
  assert.equal(chat.recent.find((m) => m.msg_id === "i1").kind, "mention");
});

test("messages outside the 10-minute window are recorded but never wake", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = watched(state, "feishu", "oc_dm", "p2p", { last_epoch: nowSec() - 1200 });
  adapter.sinceResult = () => ({ ok: true, complete: true, messages: [msg("old", nowSec() - 660)] });
  await poller.pollChat("feishu", "oc_dm", { force: true, source: "verify" });
  assert.equal(turns.wakes.length, 0, "11 分钟前的消息超出时间窗");
  const row = chat.recent.find((m) => m.msg_id === "old");
  assert.equal(row.state, "ignored");
  assert.equal(row.skip, "out-of-window");
  assert.equal(row.content, "", "窗口外的消息不留在待投集合");
  assert.equal(state.pendingMessages(chat).length, 0);

  adapter.sinceResult = () => ({ ok: true, complete: true, messages: [msg("new", nowSec() - 5)] });
  await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(turns.wakes.length, 1);
  assert.deepEqual(turns.wakes[0].opts.batch.map((m) => m.msg_id), ["new"], "旧消息不随新消息一起发");
});

test("a hit inside the 10-minute window still wakes", async () => {
  const { state, poller, adapter, turns } = setup();
  watched(state, "feishu", "oc_dm", "p2p", { last_epoch: nowSec() - 1200 });
  adapter.sinceResult = () => ({
    ok: true, complete: true,
    messages: [msg("warm", nowSec() - 540, {
      content: "@我 看下", mentions: [{ id: { open_id: "ou_me" } }],
    })],
  });
  await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(turns.wakes.length, 1);
  assert.equal(turns.wakes[0].opts.batch[0].msg_id, "warm");
});

test("empty seen ring does not replay messages before the watermark", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = watched(state, "feishu", "oc_dm", "p2p", { last_epoch: nowSec() - 400, seen: [] });
  adapter.sinceResult = () => ({
    ok: true, complete: true,
    messages: [msg("fresh", nowSec() - 5), msg("old", nowSec() - 500)],
  });
  await poller.pollChat("feishu", "oc_dm", { force: true, source: "verify" });
  assert.equal(turns.wakes.length, 1);
  assert.deepEqual(turns.wakes[0].opts.batch.map((m) => m.msg_id), ["fresh"]);
  assert.equal(chat.recent.some((m) => m.msg_id === "old"), false, "水位之前的老消息不再进 recent");
  assert.ok(chat.seen.includes("old"));
});

test("a global cap of 5 sessions per minute queues the rest", async () => {
  const { state, poller, adapter, turns } = setup();
  const chats = [];
  for (let i = 0; i < 6; i += 1) chats.push(watched(state, "feishu", `oc_b${i}`, "p2p"));
  const now = nowSec();
  poller.wakeTimes = [now - 10, now - 20, now - 30, now - 40, now - 50];
  adapter.streamResult = {
    ok: true, complete: true,
    items: chats.map((c, i) => msg(`f${i}`, now - 5, { chat_id: c.chat_id })),
  };
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 0, "已到上限，先排队");
  const pending = state.getChat("feishu", "oc_b0").recent.find((m) => m.msg_id === "f0");
  assert.equal(pending.delivered_at, 0);

  poller.wakeTimes = [];
  adapter.streamResult = { ok: true, complete: true, items: [] };
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 5, "下一跳先补 5 个");
  poller.wakeTimes = [];
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 6, "再下一跳补完最后一个");
});

test("old pending rows never ride along with a fresh hit", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = watched(state, "feishu", "oc_dm", "p2p");
  const now = nowSec();
  state.mergeRecent(chat, [{
    msg_id: "old", sender_id: "ou_other", sender_name: "对方", content: "旧",
    ts: "t-old", ts_epoch: now - 1200, kind: "dm", state: "new", delivered_at: 0,
  }]);
  adapter.streamResult = { ok: true, complete: true, items: [msg("new", now - 5, { chat_id: "oc_dm" })] };
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 1);
  assert.deepEqual(turns.wakes[0].opts.batch.map((m) => m.msg_id), ["new"]);
  assert.equal(chat.recent.find((m) => m.msg_id === "old").skip, "out-of-window");
  assert.equal(chat.recent.find((m) => m.msg_id === "old").delivered_at, 0);
});

test("a chat with only old pending rows does not wake at all", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = watched(state, "feishu", "oc_dm", "p2p");
  const now = nowSec();
  state.mergeRecent(chat, [{
    msg_id: "old", sender_id: "ou_other", sender_name: "对方", content: "旧",
    ts: "t-old", ts_epoch: now - 1200, kind: "dm", state: "new", delivered_at: 0,
  }]);
  adapter.streamResult = { ok: true, complete: true, items: [] };
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 0);
  assert.equal(chat.recent.find((m) => m.msg_id === "old").state, "ignored");
});

test("the watermark never moves backwards on an old overlap", async () => {
  const { state, poller, adapter } = setup();
  const floor = nowSec() - 60;
  const chat = watched(state, "feishu", "oc_dm", "p2p", { last_epoch: floor, seen: [] });
  adapter.sinceResult = () => ({ ok: true, complete: true, messages: [msg("older", nowSec() - 120)] });
  await poller.pollChat("feishu", "oc_dm", { force: true, source: "verify" });
  assert.equal(chat.last_epoch, floor, "旧消息不能把水位拉回去");
});

test("a watermark in the future heals instead of blocking every message", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = watched(state, "feishu", "oc_dm", "p2p", { last_epoch: nowSec() + 3600, seen: [] });
  adapter.sinceResult = () => ({ ok: true, complete: true, messages: [msg("fresh", nowSec() - 5)] });
  await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(turns.wakes.length, 1);
  assert.ok(chat.last_epoch <= nowSec(), "未来水位被本轮最新消息纠正");
});

test("a stream cursor in the future is clamped for this tick", async () => {
  const { state, poller, adapter, turns } = setup();
  watched(state, "feishu", "oc_dm", "p2p");
  state.data.runtime.stream = { since: nowSec() + 3600, at: 0, ok: true, error: "" };
  adapter.streamResult = { ok: true, complete: true, items: [msg("s1", nowSec() - 5, { chat_id: "oc_dm" })] };
  await poller.fastCycle();
  assert.equal(turns.wakes.length, 1);
  assert.ok(state.data.runtime.stream.since <= nowSec());
});

test("an incomplete interval read still guarantees @ through one at-me search", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = watched(state, "feishu", "oc_grp", "group", { timer: 1 });
  adapter.sinceResult = () => ({ ok: true, complete: false, messages: [] });
  adapter.atMe = [msg("a1", nowSec() - 3, {
    chat_id: "oc_grp", content: "@我 在吗", mentions: [{ id: { open_id: "ou_me" } }],
  })];
  const r = await poller.pollChat("feishu", "oc_grp", { force: true, source: "verify" });
  assert.equal(adapter.atMeCalls, 1);
  assert.deepEqual(adapter.atMeArgs[0].chatIds, ["oc_grp"]);
  assert.equal(r.woke, true);
  assert.equal(turns.wakes[0].opts.batch[0].msg_id, "a1");
  assert.equal(chat.gap.source, "backlog");
});
