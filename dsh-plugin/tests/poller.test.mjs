import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State } from "../lib/state.js";
import { Poller } from "../lib/poller.js";
import * as duty from "../lib/duty.js";

function msg(id, epoch, extra = {}) {
  return {
    msg_id: id, sender_id: "ou_other", sender_name: "对方",
    content: `正文-${id}`, ts: `t-${epoch}`, ts_epoch: epoch,
    msg_type: "text", mentions: [], ...extra,
  };
}

class FakeAdapter {
  constructor() {
    this.messages = [];
    this.chats = [];
    this.calls = [];
    this.listCalls = 0;
    this.listArgs = [];
    this.listOk = true;
    this.atMeCalls = 0;
    this.atMe = [];
    this.selfMentions = [];
    this.selfMentionCalls = 0;
    this.selfMentionArgs = null;
    this.supportsSelfMentions = true;
    this.memberCount = 8;
    this.memberKnown = true;
    this.fetchCalls = 0;
    this.self = { ok: true, self_id: "ou_me", name: "我", detail: "" };
    this.supportsAtMe = true;
    this.canMention = true;
  }
  async whoami() { return this.self; }
  async fetchMessages(chatId, { limit = 10 } = {}) {
    this.calls.push({ chatId, limit });
    return { ok: true, messages: this.messages.slice(0, limit) };
  }
  async listChats(limit, opts) {
    this.listCalls += 1; this.listArgs.push({ limit, opts });
    return this.listOk ? { ok: true, items: this.chats } : { ok: false, items: [], error: "auth expired" };
  }
  async searchAtMe() { this.atMeCalls += 1; return { ok: true, items: this.atMe }; }
  async searchSelfMentions(args) {
    this.selfMentionCalls += 1; this.selfMentionArgs = args;
    return { ok: true, items: this.selfMentions };
  }
  async chatMembers() { return { ok: true, known: this.memberKnown, count: this.memberCount }; }
  async sendText() { return { ok: true, message_id: "om_sent" }; }
  async search() { return { ok: true, items: [] }; }
  async searchChats() { return { ok: true, items: [] }; }
}

class FakeTurns {
  constructor() {
    this.active = new Set();
    this.wakes = [];
    this.opens = [];
    this.warmCalls = 0;
    this.warmResult = { ok: true, started: true };
  }
  hostReady() { return true; }
  isActive(platform, chatId) { return this.active.has(`${platform}:${chatId}`); }
  busy(platform, chatId) { return this.active.has(`${platform}:${chatId}`); }
  async wake(chat, opts = {}) {
    this.wakes.push({ chat, opts });
    return { ok: true, started: true, turn_id: `turn-${this.wakes.length}` };
  }
  async open(chat, opts = {}) {
    this.opens.push({ chat, opts });
    this.active.add(`${chat.platform}:${chat.chat_id}`);
    return { ok: true, started: true, turn_id: `open-${this.opens.length}` };
  }
  openMessages(chat) {
    return (chat.recent || []).filter((m) => String(m.content || "").trim());
  }
  async warm(chat) {
    this.warmCalls += 1;
    this.lastWarmChat = chat;
    return this.warmResult;
  }
}

function setup(logger = { warn() {}, info() {}, error() {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-poll-"));
  const state = new State(dir);
  state.load();
  state.data.config.poll.refresh_chatlist = false;
  state.data.config.poll.cooldown_sec = 0;
  const im = { adapter: () => adapter };
  const adapter = new FakeAdapter();
  const poller = new Poller({ state, im, logger });
  const turns = new FakeTurns();
  poller.turns = turns;
  return { state, poller, adapter, turns };
}

test("first poll is baseline: caches latest, wakes nobody", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_dm", { name: "客户", kind: "p2p" });
  chat.watching = true;
  adapter.messages = [msg("m3", 1030), msg("m2", 1020), msg("m1", 1010)];

  const r = await poller.pollChat("feishu", "oc_dm");
  assert.equal(r.fetched, true);
  assert.equal(r.baseline, true);
  assert.equal(r.new, 0);
  assert.equal(r.woke, false);
  assert.equal(turns.wakes.length, 0);
  assert.equal(chat.last_epoch, 1030);
  assert.deepEqual(chat.recent.map((m) => [m.msg_id, m.state, m.content]), [
    ["m3", "ignored", ""], ["m2", "ignored", ""], ["m1", "ignored", ""],
  ]);
});

test("new inbound message becomes pending and wakes once", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_dm", { name: "客户", kind: "p2p" });
  chat.watching = true;
  adapter.messages = [msg("m1", 1010)];
  await poller.pollChat("feishu", "oc_dm");

  adapter.messages = [msg("m2", 1020), msg("m1", 1010)];
  const r = await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(r.new, 1);
  assert.equal(r.woke, true);
  assert.equal(turns.wakes.length, 1);
  assert.equal(state.pendingCount(chat), 1);
  const row = chat.recent.find((m) => m.msg_id === "m2");
  assert.equal(row.state, "new");
  assert.equal(row.content, "正文-m2");
});

test("self reply marks earlier pending messages replied and does not wake", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_dm", { name: "客户", kind: "p2p" });
  chat.watching = true;
  adapter.messages = [msg("m1", 1010)];
  await poller.pollChat("feishu", "oc_dm");

  adapter.messages = [msg("m2", 1020)];
  await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(turns.wakes.length, 1);
  turns.wakes.length = 0;

  adapter.messages = [
    msg("m3", 1030, { sender_id: "ou_me", sender_name: "我", content: "我来回" }),
    msg("m2", 1020),
    msg("m1", 1010),
  ];
  const r = await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(r.new, 0);
  assert.equal(r.woke, false);
  assert.equal(turns.wakes.length, 0);
  assert.equal(chat.recent.find((m) => m.msg_id === "m2").state, "replied");
  assert.equal(chat.recent.find((m) => m.msg_id === "m2").content, "");
  assert.equal(state.pendingCount(chat), 0);
});

test("two messages in the same second both enter the batch and wake once", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_dm", { kind: "p2p" });
  chat.watching = true;
  adapter.messages = [msg("m1", 1000)];
  await poller.pollChat("feishu", "oc_dm");
  assert.equal(chat.last_msg_id, "m1");

  adapter.messages = [msg("m3", 1000), msg("m2", 1000), msg("m1", 1000)];
  const r = await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(r.new, 2);
  assert.equal(r.woke, true);
  assert.equal(turns.wakes.length, 1);
  assert.deepEqual(turns.wakes[0].opts.batch.map((m) => m.msg_id).sort(), ["m2", "m3"]);
  assert.equal(chat.last_msg_id, "m3");
});

test("whoami failure pauses the platform and never wakes on a guessed self", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_dm", { kind: "p2p" });
  chat.watching = true;
  adapter.self = { ok: false, self_id: null, name: null, detail: "未登录" };
  adapter.messages = [msg("m1", 1000, { sender_id: "ou_me" }), msg("m0", 990)];
  const r = await poller.pollChat("feishu", "oc_dm");
  assert.equal(r.fetched, false);
  assert.match(r.error, /身份不可用/);
  assert.equal(adapter.calls.length, 0);
  assert.equal(turns.wakes.length, 0);
  assert.match(chat.last_error, /身份不可用/);
  assert.ok(poller.errors.some((e) => /身份不可用/.test(e.msg)));

  // 恢复授权后下一轮按 baseline 重新开始，再来的新消息能正常唤醒。
  adapter.self = { ok: true, self_id: "ou_me", name: "我", detail: "" };
  poller.identity.feishu.checked_at = 0;
  await poller.pollChat("feishu", "oc_dm");
  assert.equal(adapter.calls.length, 1);
  adapter.messages = [msg("m2", 1010), msg("m1", 1000), msg("m0", 990)];
  const back = await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(back.woke, true);
  assert.equal(turns.wakes.length, 1);
});

test("group non-mention is fyi and never wakes; @me wakes", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_group", { name: "群", kind: "group" });
  chat.watching = true;
  chat.timer = 1;
  adapter.messages = [msg("g1", 1010)];
  await poller.pollChat("feishu", "oc_group");

  adapter.messages = [msg("g2", 1020)];
  let r = await poller.pollChat("feishu", "oc_group", { force: true });
  assert.equal(r.new, 0);
  assert.equal(r.woke, false);
  assert.equal(chat.recent.find((m) => m.msg_id === "g2").kind, "fyi");
  assert.equal(turns.wakes.length, 0);

  adapter.messages = [
    msg("g3", 1030, { content: "@我 看下这个", mentions: [{ id: { open_id: "ou_me" } }] }),
    msg("g2", 1020), msg("g1", 1010),
  ];
  r = await poller.pollChat("feishu", "oc_group", { force: true });
  assert.equal(r.new, 1);
  assert.equal(r.woke, true);
  assert.equal(chat.recent.find((m) => m.msg_id === "g3").kind, "mention");
});

test("candidates only include watched DMs and groups with timer=1; blocked always out", () => {
  const { state, poller } = setup();
  const dm = state.ensureChat("feishu", "oc_dm", { kind: "p2p" });
  dm.watching = true;
  const grouped = state.ensureChat("feishu", "oc_g1", { kind: "group" });
  grouped.watching = true;
  grouped.timer = 1;
  const off = state.ensureChat("feishu", "oc_g2", { kind: "group" });
  off.watching = true;
  off.timer = -1;
  const blocked = state.ensureChat("feishu", "oc_dm2", { kind: "p2p" });
  blocked.watching = true;
  blocked.blocked = true;
  assert.deepEqual(poller.candidates(["feishu"]).map((c) => c.chat_id), ["oc_dm", "oc_g1"]);
});

test("a burst larger than 10 keeps only the newest 10 pointers", async () => {
  const { state, poller, adapter } = setup();
  const chat = state.ensureChat("feishu", "oc_dm", { kind: "p2p" });
  chat.watching = true;
  const rows = [];
  for (let i = 11; i >= 0; i -= 1) rows.push(msg(`b${String(i).padStart(2, "0")}`, 2000 + i));
  adapter.messages = rows;
  await poller.pollChat("feishu", "oc_dm");
  assert.equal(chat.recent.length, 10);
  assert.equal(chat.recent[0].msg_id, "b11");
  assert.equal(chat.recent.at(-1).msg_id, "b02");
});

test("failed wake is retried on a later cycle while pending remains", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_dm", { kind: "p2p" });
  chat.watching = true;
  adapter.messages = [msg("m1", 1010)];
  await poller.pollChat("feishu", "oc_dm");

  adapter.messages = [msg("m2", 1020), msg("m1", 1010)];
  turns.wake = async (c) => {
    c.wake.failed = true;
    return { ok: false, reason: "host_unavailable" };
  };
  let r = await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(r.woke, false);
  assert.equal(chat.wake.failed, true);

  turns.wake = async (c, opts) => { turns.wakes.push({ chat: c, opts }); return { ok: true }; };
  r = await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(r.woke, true);
  assert.equal(turns.wakes.at(-1).opts.batch, undefined);
});

test("blocked chat is not fetched at all", async () => {
  const { state, poller, adapter } = setup();
  const chat = state.ensureChat("feishu", "oc_dm", { kind: "p2p" });
  chat.watching = true;
  chat.blocked = true;
  adapter.messages = [msg("m1", 1010)];
  const r = await poller.pollChat("feishu", "oc_dm");
  assert.equal(r.fetched, false);
  assert.equal(r.blocked, true);
  assert.equal(adapter.calls.length, 0);
});

test("read-only polling leaves the water mark so the next cycle still wakes", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_dm", { kind: "p2p" });
  chat.watching = true;
  adapter.messages = [msg("m1", 1010)];
  await poller.pollChat("feishu", "oc_dm");
  assert.equal(chat.last_msg_id, "m1");

  adapter.messages = [msg("m2", 1020), msg("m1", 1010)];
  const peek = await poller.pollChat("feishu", "oc_dm", { wake: false, force: true });
  assert.equal(peek.new, 1);
  assert.equal(peek.woke, false);
  assert.equal(turns.wakes.length, 0);
  assert.equal(chat.last_msg_id, "m1");
  assert.equal(state.pendingCount(chat), 1);

  const timed = await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(timed.woke, true);
  assert.equal(turns.wakes.length, 1);
  assert.equal(chat.last_msg_id, "m2");
});

test("manual poll honors cooldown_sec while post-turn force bypasses it", async () => {
  const { state, poller, adapter } = setup();
  const chat = state.ensureChat("feishu", "oc_dm", { kind: "p2p" });
  chat.watching = true;
  state.data.config.poll.cooldown_sec = 20;
  adapter.messages = [msg("m1", 1010)];
  await poller.pollChat("feishu", "oc_dm");
  const again = await poller.pollChat("feishu", "oc_dm");
  assert.equal(again.fetched, false);
  assert.match(again.skipped, /刚拉过/);
  const forced = await poller.pollChat("feishu", "oc_dm", { force: true });
  assert.equal(forced.fetched, true);
});

test("feishu page size and thread limit are clamped to CLI caps", async () => {
  const { state, poller, adapter } = setup();
  state.data.config.poll.dm_recent = 200;
  let listLimit = 0;
  adapter.listChats = async (limit) => { listLimit = limit; return { ok: true, items: [] }; };
  await poller.refreshChatlist(["feishu"]);
  assert.equal(listLimit, 100);

  await poller.fetchThread("feishu", "oc_dm", 100);
  assert.equal(adapter.calls.at(-1).limit, 50);
});

test("unknown platforms are reported as legacy; dingtalk waits for the switch", () => {
  const { state, poller } = setup();
  const old = state.ensureChat("slack", "cid_old", { kind: "p2p" });
  old.watching = true;
  const dm = state.ensureChat("dingtalk", "cid_dm", { kind: "p2p" });
  dm.watching = true;
  assert.deepEqual(poller.legacyPlatforms(), ["slack"]);
  assert.deepEqual(poller.candidates(["feishu", "wecom"]).map((c) => c.chat_id), []);
  assert.deepEqual(
    poller.candidates(["feishu", "wecom", "dingtalk"]).map((c) => c.chat_id), ["cid_dm"]);
});

test("fast lane polls watched chats and never refreshes the chat list", async () => {
  const { state, poller, adapter } = setup();
  state.data.config.poll.refresh_chatlist = true;
  state.data.config.poll.fast_sec = 60;
  const dm = state.ensureChat("feishu", "oc_dm", { name: "客户", kind: "p2p" });
  dm.watching = true;
  const group = state.ensureChat("feishu", "oc_grp", { name: "群", kind: "group" });
  group.watching = true; group.timer = 1;
  const muted = state.ensureChat("feishu", "oc_muted", { name: "不拉", kind: "p2p" });
  muted.watching = true; muted.timer = -1;
  const quiet = state.ensureChat("feishu", "oc_quiet", { name: "默认群", kind: "group" });
  quiet.watching = true; quiet.timer = 0;

  poller.nextCycleAt = Date.now() / 1000 + 3600; // 还没到慢车道
  await poller.tick();
  poller.stop();

  assert.equal(adapter.listCalls, 0, "快车道不应刷会话列表");
  assert.deepEqual(adapter.calls.map((c) => c.chatId).sort(), ["oc_dm", "oc_grp"]);
  assert.equal(poller.fastSec, 60);
  assert.ok(poller.lastFast.at > 0);
  assert.equal(poller.lastFast.targets, 2);
});

test("fast_sec=0 falls back to the slow lane only", async () => {
  const { state, poller, adapter } = setup();
  state.data.config.poll.fast_sec = 0;
  const dm = state.ensureChat("feishu", "oc_dm", { name: "客户", kind: "p2p" });
  dm.watching = true;

  poller.nextCycleAt = Date.now() / 1000 + 3600;
  await poller.tick();
  poller.stop();

  assert.equal(poller.fastSec, 0);
  assert.equal(adapter.calls.length, 0, "关掉快车道后不该在慢车道之前拉");
});

test("paused stops both lanes", async () => {
  const { state, poller, adapter } = setup();
  state.data.paused = true;
  const dm = state.ensureChat("feishu", "oc_dm", { name: "客户", kind: "p2p" });
  dm.watching = true;

  poller.nextCycleAt = Date.now() / 1000 - 1;
  await poller.tick();
  poller.stop();

  assert.equal(adapter.calls.length, 0);
  assert.ok(poller.nextCycleAt > Date.now() / 1000);
});

test("all-mode group wakes on non-mention and keeps the body", async () => {
  const { state, poller, adapter, turns } = setup();
  state.data.config.poll.group_wake_sec = 0;
  const chat = state.ensureChat("feishu", "oc_all", { name: "群", kind: "group" });
  chat.watching = true;
  chat.timer = 1;
  chat.wake_mode = "all";
  adapter.messages = [msg("a1", 3010)];
  await poller.pollChat("feishu", "oc_all");

  adapter.messages = [msg("a2", 3020), msg("a1", 3010)];
  const r = await poller.pollChat("feishu", "oc_all", { force: true });
  assert.equal(r.woke, true);
  assert.equal(turns.wakes.length, 1);
  const row = chat.recent.find((m) => m.msg_id === "a2");
  assert.equal(row.kind, "fyi");
  assert.equal(row.state, "new");
  assert.equal(row.content, "正文-a2");
  assert.equal(turns.wakes[0].opts.batch.at(-1).msg_id, "a2");
  assert.equal(chat.last_wake_epoch, 3020);

  // 同一批消息不会再投递一次
  const again = await poller.pollChat("feishu", "oc_all", { force: true });
  assert.equal(again.woke, false);
  assert.equal(turns.wakes.length, 1);
});

test("all-mode merges inside the window and flushes the backlog afterwards", async () => {
  const { state, poller, adapter, turns } = setup();
  state.data.config.poll.group_wake_sec = 60;
  const chat = state.ensureChat("feishu", "oc_all", { name: "群", kind: "group" });
  chat.watching = true;
  chat.timer = 1;
  chat.wake_mode = "all";
  adapter.messages = [msg("b1", 4010)];
  await poller.pollChat("feishu", "oc_all");

  adapter.messages = [msg("b2", 4020), msg("b1", 4010)];
  await poller.pollChat("feishu", "oc_all", { force: true });
  assert.equal(turns.wakes.length, 1);
  assert.ok(chat.last_wake_at > 0);

  adapter.messages = [msg("b3", 4030), msg("b2", 4020), msg("b1", 4010)];
  const win = await poller.pollChat("feishu", "oc_all", { force: true });
  assert.equal(win.woke, false, "窗口内不唤醒");
  const b3 = chat.recent.find((m) => m.msg_id === "b3");
  assert.equal(b3.state, "new");
  b3.state = "opened"; // 点开看过不等于处理过，也要补投

  chat.last_wake_at = 1; // 模拟窗口过去
  const flush = await poller.pollChat("feishu", "oc_all", { force: true });
  assert.equal(flush.woke, true);
  const first = turns.wakes[0].opts.batch.map((m) => m.msg_id);
  assert.deepEqual(first, ["b2"], "第一次唤醒只带 b2");
  const ids = turns.wakes.at(-1).opts.batch.map((m) => m.msg_id);
  assert.deepEqual(ids, ["b3"], "窗口过去只补没投递过的 b3");
});

test("mention-mode groups still ignore non-mentions (regression)", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_m", { name: "群", kind: "group" });
  chat.watching = true;
  chat.timer = 1;
  adapter.messages = [msg("c1", 5010)];
  await poller.pollChat("feishu", "oc_m");
  adapter.messages = [msg("c2", 5020), msg("c1", 5010)];
  const r = await poller.pollChat("feishu", "oc_m", { force: true });
  assert.equal(r.woke, false);
  assert.equal(turns.wakes.length, 0);
  assert.equal(chat.recent.find((m) => m.msg_id === "c2").state, "ignored");
  assert.equal(chat.wake_mode, "mention");
});

test("mention-mode DMs ignore chatter and wake on structured or literal @", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_dm_mention", { name: "客户", kind: "p2p" });
  chat.watching = true;
  chat.wake_mode = "mention";
  adapter.messages = [msg("d1", 6010)];
  await poller.pollChat("feishu", "oc_dm_mention");

  // 闲聊：记知会见、不落正文、不算待回、不唤醒。
  adapter.messages = [msg("d2", 6020, { content: "中午吃啥" }), msg("d1", 6010)];
  let r = await poller.pollChat("feishu", "oc_dm_mention", { force: true });
  assert.equal(r.woke, false);
  assert.equal(turns.wakes.length, 0);
  assert.equal(state.pendingCount(chat), 0);
  const chatter = chat.recent.find((m) => m.msg_id === "d2");
  assert.equal(chatter.kind, "fyi");
  assert.equal(chatter.state, "ignored");
  assert.equal(chatter.content, "");

  // 结构化 @：唤醒、批次只带这一条，kind 仍是 dm（留在「私聊」筛选里）。
  adapter.messages = [
    msg("d3", 6030, { content: "@_user_1 看下这个", mentions: [{ id: { open_id: "ou_me" } }] }),
    msg("d2", 6020, { content: "中午吃啥" }), msg("d1", 6010),
  ];
  r = await poller.pollChat("feishu", "oc_dm_mention", { force: true });
  assert.equal(r.woke, true);
  assert.equal(turns.wakes.length, 1);
  assert.deepEqual(turns.wakes[0].opts.batch.map((m) => m.msg_id), ["d3"]);
  assert.equal(chat.recent.find((m) => m.msg_id === "d3").kind, "dm");

  // 正文 @ 本人显示名：同样唤醒。
  adapter.messages = [msg("d4", 6040, { content: "@我 帮看下" }), msg("d3", 6030), msg("d2", 6020), msg("d1", 6010)];
  r = await poller.pollChat("feishu", "oc_dm_mention", { force: true });
  assert.equal(r.woke, true);
  assert.deepEqual(turns.wakes.at(-1).opts.batch.map((m) => m.msg_id), ["d4"]);

  // @ 别人不算：不误唤醒。
  adapter.messages = [
    msg("d5", 6050, { content: "@张三丰 看下", mentions: [{ id: { open_id: "ou_other" }, name: "张三丰" }] }),
    msg("d4", 6040, { content: "@我 帮看下" }), msg("d3", 6030), msg("d2", 6020), msg("d1", 6010),
  ];
  r = await poller.pollChat("feishu", "oc_dm_mention", { force: true });
  assert.equal(r.woke, false);
  assert.equal(turns.wakes.length, 2);
  assert.equal(chat.recent.find((m) => m.msg_id === "d5").kind, "fyi");
});

test("DMs keep every message waking by default (all mode)", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_dm_all", { name: "客户", kind: "p2p" });
  chat.watching = true;
  assert.equal(chat.wake_mode, "all");
  adapter.messages = [msg("e1", 7010)];
  await poller.pollChat("feishu", "oc_dm_all");
  adapter.messages = [msg("e2", 7020, { content: "随便聊聊" }), msg("e1", 7010)];
  const r = await poller.pollChat("feishu", "oc_dm_all", { force: true });
  assert.equal(r.woke, true);
  assert.equal(turns.wakes.length, 1);
  assert.equal(chat.recent.find((m) => m.msg_id === "e2").kind, "dm");
});

test("self-@ in a DM is a command to the stand-in and wakes it (mention mode)", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_cmd", { name: "客户", kind: "p2p" });
  chat.watching = true;
  chat.wake_mode = "mention";
  adapter.messages = [msg("c1", 8010)];
  await poller.pollChat("feishu", "oc_cmd");

  // 本人 @ 自己：记 cmd/new、保留正文、唤醒，但不算待回。
  adapter.messages = [
    msg("c2", 8020, { sender_id: "ou_me", sender_name: "我", content: "@我 帮我回他一句" }),
    msg("c1", 8010),
  ];
  const r = await poller.pollChat("feishu", "oc_cmd", { force: true });
  assert.equal(r.woke, true);
  assert.equal(turns.wakes.length, 1);
  assert.deepEqual(turns.wakes[0].opts.batch.map((m) => m.msg_id), ["c2"]);
  const cmd = chat.recent.find((m) => m.msg_id === "c2");
  assert.equal(cmd.kind, "cmd");
  assert.equal(cmd.state, "new");
  assert.match(cmd.content, /帮我回他一句/, "指令正文要留给 agent");
  assert.equal(state.pendingCount(chat), 0, "指令不算客户待回");
  assert.equal(state.counts().unread, 0, "不刷未读角标");

  // 本人不 @ 的消息仍然是 out，不唤醒（防回环回归）。
  adapter.messages = [
    msg("c3", 8030, { sender_id: "ou_me", sender_name: "我", content: "我自己说一句" }),
    msg("c2", 8020, { sender_id: "ou_me", sender_name: "我", content: "@我 帮我回他一句" }),
    msg("c1", 8010),
  ];
  const r2 = await poller.pollChat("feishu", "oc_cmd", { force: true });
  assert.equal(r2.woke, false);
  assert.equal(turns.wakes.length, 1);
  assert.equal(chat.recent.find((m) => m.msg_id === "c3").kind, "out");
});

test("self-@ wakes in DM all mode too, and in groups", async () => {
  const { state, poller, adapter, turns } = setup();
  const dm = state.ensureChat("feishu", "oc_cmd_all", { name: "客户", kind: "p2p" });
  dm.watching = true;
  assert.equal(dm.wake_mode, "all");
  adapter.messages = [msg("a1", 9010)];
  await poller.pollChat("feishu", "oc_cmd_all");
  adapter.messages = [
    msg("a2", 9020, { sender_id: "ou_me", sender_name: "我", content: "@我 在吗" }),
    msg("a1", 9010),
  ];
  let r = await poller.pollChat("feishu", "oc_cmd_all", { force: true });
  assert.equal(r.woke, true);
  assert.equal(turns.wakes.length, 1);
  assert.equal(dm.recent.find((m) => m.msg_id === "a2").kind, "cmd");

  // 群里的自 @ 也是指令：kind=cmd、唤醒一次、不算客户待回。
  const grp = state.ensureChat("feishu", "oc_cmd_grp", { name: "群", kind: "group" });
  grp.watching = true;
  grp.timer = 1;
  adapter.messages = [msg("g1", 9030)];
  await poller.pollChat("feishu", "oc_cmd_grp");
  adapter.messages = [
    msg("g2", 9040, { sender_id: "ou_me", sender_name: "我", content: "@我 测试一下" }),
    msg("g1", 9030),
  ];
  r = await poller.pollChat("feishu", "oc_cmd_grp", { force: true });
  assert.equal(r.woke, true);
  assert.equal(turns.wakes.length, 2);
  assert.deepEqual(turns.wakes[1].opts.batch.map((m) => m.msg_id), ["g2"]);
  const g2 = grp.recent.find((m) => m.msg_id === "g2");
  assert.equal(g2.kind, "cmd");
  assert.equal(g2.state, "new");
  assert.match(g2.content, /测试一下/, "指令正文要留给 agent");
  assert.equal(state.pendingCount(grp), 0, "群里的指令也不算客户待回");

  // 群里本人不 @ 的消息仍是 out、不唤醒（防回环回归）。
  adapter.messages = [
    msg("g3", 9050, { sender_id: "ou_me", sender_name: "我", content: "我自己说一句" }),
    msg("g2", 9040, { sender_id: "ou_me", sender_name: "我", content: "@我 测试一下" }),
    msg("g1", 9030),
  ];
  r = await poller.pollChat("feishu", "oc_cmd_grp", { force: true });
  assert.equal(r.woke, false);
  assert.equal(turns.wakes.length, 2);
  assert.equal(grp.recent.find((m) => m.msg_id === "g3").kind, "out");
});

test("self-@ in an all-mode group wakes immediately, bypassing the merge window", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_cmd_gall", { name: "群", kind: "group" });
  chat.watching = true;
  chat.timer = 1;
  chat.wake_mode = "all";
  adapter.messages = [msg("w1", 11010)];
  await poller.pollChat("feishu", "oc_cmd_gall");

  // 旁观消息唤醒一次，合并窗口从这一刻开始计时。
  adapter.messages = [msg("w2", 11020, { content: "随便聊聊" }), msg("w1", 11010)];
  let r = await poller.pollChat("feishu", "oc_cmd_gall", { force: true });
  assert.equal(r.woke, true);
  const afterChatter = turns.wakes.length;

  // 窗口内的第二条旁观消息：攒着，不唤醒。
  adapter.messages = [
    msg("w3", 11030, { content: "接着说" }),
    msg("w2", 11020, { content: "随便聊聊" }),
    msg("w1", 11010),
  ];
  r = await poller.pollChat("feishu", "oc_cmd_gall", { force: true });
  assert.equal(r.woke, false);
  assert.equal(turns.wakes.length, afterChatter);

  // 窗口内的指令：不等窗口，立刻唤醒，连同刚才攒下的旁观消息一起给。
  adapter.messages = [
    msg("w4", 11040, { sender_id: "ou_me", sender_name: "我", content: "@我 看下 w2 那条" }),
    msg("w3", 11030, { content: "接着说" }),
    msg("w2", 11020, { content: "随便聊聊" }),
    msg("w1", 11010),
  ];
  r = await poller.pollChat("feishu", "oc_cmd_gall", { force: true });
  assert.equal(r.woke, true);
  assert.equal(turns.wakes.length, afterChatter + 1);
  assert.deepEqual(turns.wakes.at(-1).opts.batch.map((m) => m.msg_id).sort(), ["w3", "w4"]);
  assert.equal(chat.recent.find((m) => m.msg_id === "w4").kind, "cmd");
  assert.equal(Number(chat.last_wake_epoch), 11040);
});

test("a group command does not swallow a pending counterpart mention", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_cmd_gkeep", { name: "群", kind: "group" });
  chat.watching = true;
  chat.timer = 1;
  adapter.messages = [msg("k0", 12000)];
  await poller.pollChat("feishu", "oc_cmd_gkeep");

  // 同一批里：对面 @ 我 + 我下指令。指令不算"已回复"，对面那条仍是待回。
  adapter.messages = [
    msg("k2", 12020, { sender_id: "ou_me", sender_name: "我", content: "@我 先看下" }),
    msg("k1", 12010, { content: "@我 在吗", mentions: [{ id: { open_id: "ou_me" } }] }),
    msg("k0", 12000),
  ];
  const r = await poller.pollChat("feishu", "oc_cmd_gkeep", { force: true });
  assert.equal(r.woke, true);
  assert.deepEqual(turns.wakes[0].opts.batch.map((m) => m.msg_id).sort(), ["k1", "k2"]);
  assert.equal(chat.recent.find((m) => m.msg_id === "k1").state, "new");
  assert.equal(chat.recent.find((m) => m.msg_id === "k2").kind, "cmd");
});

test("a command does not swallow a pending counterpart message as replied", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_cmd_keep", { name: "客户", kind: "p2p" });
  chat.watching = true;
  chat.wake_mode = "mention";
  adapter.messages = [msg("k1", 9510)];
  await poller.pollChat("feishu", "oc_cmd_keep");

  // 同一批里：对面 @ 我 + 我下指令。指令不算"已回复"，对面那条仍是待回。
  adapter.messages = [
    msg("k3", 9530, { sender_id: "ou_me", sender_name: "我", content: "@我 先看下" }),
    msg("k2", 9520, { content: "@我 在吗" }),
    msg("k1", 9510),
  ];
  const r = await poller.pollChat("feishu", "oc_cmd_keep", { force: true });
  assert.equal(r.woke, true);
  assert.deepEqual(turns.wakes[0].opts.batch.map((m) => m.msg_id).sort(), ["k2", "k3"]);
  assert.equal(chat.recent.find((m) => m.msg_id === "k2").state, "new");
  assert.equal(chat.recent.find((m) => m.msg_id === "k3").kind, "cmd");
});

test("command wake has a circuit breaker (5 per 10 minutes)", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_cmd_loop", { name: "客户", kind: "p2p" });
  chat.watching = true;
  chat.wake_mode = "mention";
  adapter.messages = [msg("z0", 10000)];
  await poller.pollChat("feishu", "oc_cmd_loop");
  let prev = "z0";
  for (let i = 1; i <= 6; i += 1) {
    const id = `z${i}`;
    adapter.messages = [
      msg(id, 10000 + i * 10, { sender_id: "ou_me", sender_name: "我", content: "@我 第 " + i + " 条" }),
      msg(prev, 10000 + (i - 1) * 10, { sender_id: i === 1 ? "ou_other" : "ou_me",
                                       sender_name: i === 1 ? "对方" : "我",
                                       content: i === 1 ? "正文-z0" : "@我 第 " + (i - 1) + " 条" }),
    ];
    await poller.pollChat("feishu", "oc_cmd_loop", { force: true });
    prev = id;
  }
  assert.equal(turns.wakes.length, 5, "前 5 条唤醒，第 6 条被熔断");
  assert.match(chat.last_error, /本人指令.*暂停唤醒/);
});

test("a start command never opens a second duty in an already-watched chat", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_start_busy", { name: "客户", kind: "p2p" });
  chat.watching = true;
  chat.wake_mode = "mention";
  chat.dsh_session = "session-existing";
  adapter.messages = [msg("b0", 13000)];
  await poller.pollChat("feishu", "oc_start_busy");

  adapter.messages = [
    msg("b1", 13010, { sender_id: "ou_me", sender_name: "我", content: "@我 启动值班" }),
    msg("b0", 13000),
  ];
  const r = await poller.pollChat("feishu", "oc_start_busy", { force: true });
  assert.equal(r.woke, false);
  assert.equal(r.command.result, "already");
  assert.equal(turns.opens.length, 0, "不能有第二个会话");
  assert.equal(turns.wakes.length, 0, "启动开关不再交给 agent");
  assert.equal(chat.dsh_session, "session-existing");
  assert.equal(chat.command.msg_id, "b1");
  assert.match(chat.command.reason, /没有重复创建/);
});

test("a start command in an unwatched DM starts duty and opens one session", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_start_dm", { name: "客户", kind: "p2p" });
  adapter.messages = [msg("d0", 13100)];
  await poller.pollChat("feishu", "oc_start_dm");
  adapter.messages = [
    msg("d1", 13110, {
      sender_id: "ou_me", sender_name: "我", content: "@我 启动一下",
      mentions: [{ id: { open_id: "ou_me" } }],
    }),
    msg("d0", 13100),
  ];
  const r = await poller.pollChat("feishu", "oc_start_dm", { force: true });
  assert.equal(r.command.result, "started");
  assert.equal(r.woke, false, "开场 turn 已包含上下文，不再额外唤醒");
  assert.equal(chat.watching, true);
  assert.equal(chat.timer, 1);
  assert.equal(chat.target, true);
  assert.equal(chat.wake_mode, "all");
  assert.equal(chat.send_mode, "draft");
  assert.equal(chat.duty.state, "watch");
  assert.equal(chat.duty.by, "user");
  assert.equal(chat.command.msg_id, "d1");
  assert.equal(turns.opens.length, 1);
  assert.equal(turns.opens[0].opts.reason, "command");
  assert.equal(turns.opens[0].opts.dutyContext.command.keyword, "启动");
  assert.equal(turns.wakes.length, 0);
  assert.ok(chat.recent.some((m) => m.msg_id === "d1" && m.kind === "cmd"));
});

test("a start command in an unwatched group defaults to mention-only", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_start_grp", { name: "项目群", kind: "group" });
  adapter.messages = [msg("g0", 13200)];
  await poller.pollChat("feishu", "oc_start_grp");
  adapter.messages = [
    msg("g1", 13210, {
      sender_id: "ou_me", sender_name: "我", content: "@我 启动值守",
      mentions: [{ id: { open_id: "ou_me" } }],
    }),
    msg("g0", 13200),
  ];
  const r = await poller.pollChat("feishu", "oc_start_grp", { force: true });
  assert.equal(r.command.result, "started");
  assert.equal(chat.watching, true);
  assert.equal(chat.timer, 1);
  assert.equal(chat.wake_mode, "mention");
  assert.equal(turns.opens.length, 1);
  assert.equal(turns.opens[0].chat.kind, "group");
  assert.equal(turns.wakes.length, 0);
});

test("a read-only poll never starts duty from a start command", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_start_readonly", { name: "客户", kind: "p2p" });
  adapter.messages = [msg("r0", 13250)];
  await poller.pollChat("feishu", "oc_start_readonly");
  adapter.messages = [
    msg("r1", 13260, {
      sender_id: "ou_me", sender_name: "我", content: "@我 启动",
      mentions: [{ id: { open_id: "ou_me" } }],
    }),
    msg("r0", 13250),
  ];
  const r = await poller.pollChat("feishu", "oc_start_readonly", { force: true, wake: false });
  assert.equal(r.command, null);
  assert.equal(chat.watching, false);
  assert.equal(turns.opens.length, 0);
  assert.equal(chat.command.msg_id, "");
});

test("a watched chat with no bound session is healed instead of treated as a conflict", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_start_heal", { name: "客户", kind: "p2p" });
  chat.watching = true;
  chat.timer = 1;
  chat.wake_mode = "mention";
  chat.dsh_session = "";
  adapter.messages = [msg("h0", 13300)];
  await poller.pollChat("feishu", "oc_start_heal");
  adapter.messages = [
    msg("h1", 13310, {
      sender_id: "ou_me", sender_name: "我", content: "@我 启动",
      mentions: [{ id: { open_id: "ou_me" } }],
    }),
    msg("h0", 13300),
  ];
  const r = await poller.pollChat("feishu", "oc_start_heal", { force: true });
  assert.equal(r.command.result, "started");
  assert.equal(turns.opens.length, 1);
  assert.equal(turns.wakes.length, 0);
});

test("the start keyword is configurable and can be switched off", async () => {
  const { state, poller, adapter, turns } = setup();
  state.data.config.command.start_keyword = "go";
  const chat = state.ensureChat("feishu", "oc_start_kw", { name: "客户", kind: "p2p" });
  chat.watching = true;
  chat.wake_mode = "mention";
  adapter.messages = [msg("k0", 13400)];
  await poller.pollChat("feishu", "oc_start_kw");

  // 旧词不再触发：仍按普通 cmd 唤醒。
  adapter.messages = [
    msg("k1", 13410, {
      sender_id: "ou_me", sender_name: "我", content: "@我 启动",
      mentions: [{ id: { open_id: "ou_me" } }],
    }),
    msg("k0", 13400),
  ];
  let r = await poller.pollChat("feishu", "oc_start_kw", { force: true });
  assert.equal(r.command, null);
  assert.equal(turns.wakes.length, 1);
  assert.equal(turns.opens.length, 0);

  // 新词命中：启动值班（当前没有绑定会话，补开一个）。
  adapter.messages = [
    msg("k2", 13420, {
      sender_id: "ou_me", sender_name: "我", content: "@我 go 值班",
      mentions: [{ id: { open_id: "ou_me" } }],
    }),
    msg("k1", 13410),
    msg("k0", 13400),
  ];
  r = await poller.pollChat("feishu", "oc_start_kw", { force: true });
  assert.equal(r.command.result, "started");
  assert.equal(turns.opens.length, 1);

  // 整体关闭：关键词消息回到普通 cmd。
  state.data.config.command.enabled = false;
  adapter.messages = [
    msg("k3", 13430, {
      sender_id: "ou_me", sender_name: "我", content: "@我 go 再看一下",
      mentions: [{ id: { open_id: "ou_me" } }],
    }),
    msg("k2", 13420),
    msg("k1", 13410),
    msg("k0", 13400),
  ];
  r = await poller.pollChat("feishu", "oc_start_kw", { force: true });
  assert.equal(r.command, null);
  assert.equal(turns.wakes.length, 2);
  assert.equal(turns.opens.length, 1);
});

test("a start command supersedes a triage probe instead of being overwritten", async () => {
  const { state, poller, adapter, turns } = setup();
  const chat = state.ensureChat("feishu", "oc_cmd_race", { name: "项目群", kind: "group" });
  duty.newEvent(chat, "manual", { id: "evt-race", at: 13600 });
  state.save();
  let releaseProbe;
  const probeGate = new Promise((resolve) => { releaseProbe = resolve; });
  let markStarted;
  const probeStarted = new Promise((resolve) => { markStarted = resolve; });
  adapter.fetchMessages = async () => {
    markStarted();
    await probeGate;
    return { ok: true, messages: [msg("race0", 13610, { content: "普通消息" })] };
  };

  const triage = poller.startTriage(chat);
  await probeStarted;
  const started = await poller.startDutyFromCommand(chat, {
    msg_id: "race1", sender_id: "ou_me", sender_name: "我", content: "@我 启动",
    ts_epoch: 13620, kind: "cmd",
  }, { source: "poll", keyword: "启动" });
  assert.equal(started.result, "started");
  assert.equal(chat.watching, true);
  assert.equal(chat.duty.by, "user");
  assert.equal(chat.duty.state, "watch");
  assert.equal(turns.opens.length, 1);

  releaseProbe();
  const out = await triage;
  assert.equal(out.reason, "superseded", "陈旧分诊不能再覆盖用户手动接管");
  assert.equal(chat.duty.state, "watch");
  assert.equal(chat.duty.by, "user");
});

test("the command scan discovers self-@ start commands in unwatched p2p and group chats", async () => {
  const { state, poller, adapter, turns } = setup();
  const mention = { id: { open_id: "ou_me" } };
  adapter.selfMentions = [{
    msg_id: "s1", chat_id: "oc_scan_dm", chat_type: "p2p",
    sender_id: "ou_me", sender_name: "我", content: "@我 启动",
    mentions: [mention], ts_epoch: 13510,
  }, {
    msg_id: "s2", chat_id: "oc_scan_grp", chat_type: "group",
    sender_id: "ou_me", sender_name: "我", content: "@我 启动值班",
    chat_name: "项目群", mentions: [mention], ts_epoch: 13520,
  }, {
    msg_id: "s3", chat_id: "oc_scan_other", chat_type: "p2p",
    sender_id: "ou_me", sender_name: "我", content: "@我 随便说说",
    mentions: [mention], ts_epoch: 13530,
  }];

  adapter.messages = [
    msg("x2", 13511, { sender_id: "ou_other", sender_name: "客户", content: "这个谁看下" }),
    msg("x1", 13510, {
      sender_id: "ou_me", sender_name: "我", content: "@我 启动",
      mentions: [mention],
    }),
  ];

  const ok = await poller.maybeCommandScan({ force: true });
  assert.equal(ok, true);
  assert.equal(adapter.selfMentionCalls, 1);
  assert.equal(adapter.selfMentionArgs.selfId, "ou_me");
  const dm = state.getChat("feishu", "oc_scan_dm");
  const grp = state.getChat("feishu", "oc_scan_grp");
  assert.ok(dm && dm.watching, "未值守私聊被扫描启动");
  assert.ok(grp && grp.watching, "未值守群被扫描启动");
  assert.equal(grp.kind, "group");
  assert.equal(grp.wake_mode, "mention");
  assert.equal(dm.command.result, "started");
  assert.equal(turns.opens.length, 2);
  assert.equal(poller.lastCommandScan.started, 2);
  const ctxRows = turns.opens[0].opts.dutyContext.messages;
  assert.ok(ctxRows.some((m) => m.content === "@我 启动" && m.kind === "cmd"),
    "开场上下文保留启动指令原文");
  assert.ok(ctxRows.some((m) => m.content === "这个谁看下"),
    "首次见到的会话也要把客户原文带进开场，而不是 baseline 清空后只剩指令");
  assert.equal(poller.lastCommandScan.matched, 2, "不带关键词的自 @ 不匹配");
  assert.equal(state.getChat("feishu", "oc_scan_other"), null, "没命中就不建会话行");

  // 同一 msg_id 再次扫到：幂等，不再开第二个会话。
  await poller.maybeCommandScan({ force: true });
  assert.equal(turns.opens.length, 2);
  assert.equal(dm.command.msg_id, "s1");
});

test("the command scan runs at most once a minute unless forced", async () => {
  const { poller, adapter } = setup();
  adapter.selfMentions = [];
  poller.commandScanAt = Date.now() / 1000 - 30;
  assert.equal(await poller.maybeCommandScan(), false);
  assert.equal(adapter.selfMentionCalls, 0, "30 秒内不重复打搜索接口");

  poller.commandScanAt = Date.now() / 1000 - 61;
  assert.equal(await poller.maybeCommandScan(), true);
  assert.equal(adapter.selfMentionCalls, 1);
  assert.equal(await poller.maybeCommandScan(), false, "刚扫过，下一分钟前不再扫");
  assert.equal(adapter.selfMentionCalls, 1);
});

test("a failed command scan only records the error and leaves polling alone", async () => {
  const { state, poller, adapter } = setup();
  adapter.searchSelfMentions = async () => ({
    ok: false, items: [], error: "permission denied",
  });
  const ok = await poller.maybeCommandScan({ force: true });
  assert.equal(ok, true);
  assert.equal(poller.lastCommandScan.ok, false);
  assert.match(poller.lastCommandScan.error, /permission denied/);
});

function warmChat(state, { platform = "feishu", chatId = "oc_warm", idleMin = 60 } = {}) {
  const chat = state.ensureChat(platform, chatId, { name: "保温对象", kind: "p2p" });
  chat.watching = true;
  chat.dsh_session = "session-1";
  chat.prompt_session = "session-1";
  chat.session_bound_at = Date.now() / 1000 - idleMin * 60;
  chat.last_turn = { ok: true, reason: "", at: chat.session_bound_at };
  state.save();
  return chat;
}

test("heartbeat warms one eligible session per tick and backs off after a failure", async () => {
  const { state, poller, turns } = setup();
  const chat = warmChat(state);
  assert.equal(await poller.maybeWarm(), true);
  assert.equal(turns.warmCalls, 1);
  assert.equal(turns.lastWarmChat, chat);

  // 这段闲置已经保温过：不再保第二次。
  chat.last_warm_at = Date.now() / 1000;
  assert.equal(await poller.maybeWarm(), false);
  assert.equal(turns.warmCalls, 1);

  // 启动失败也记账一次，不每个 tick 重试。
  chat.last_warm_at = 0;
  turns.warmResult = { ok: false, reason: "no_session" };
  assert.equal(await poller.maybeWarm(), true);
  assert.equal(turns.warmCalls, 2);
  assert.equal(chat.last_warm_ok, false);
  assert.ok(chat.last_warm_at > 0);
  assert.equal(await poller.maybeWarm(), false);
  assert.equal(turns.warmCalls, 2);
});

test("heartbeat stops after the second warm cycle and restarts after a real turn", async () => {
  const { state, poller, turns } = setup();
  const chat = warmChat(state, { idleMin: 120 });
  const now = Date.now() / 1000;
  // 第一个周期（55 分钟）保过温，现在已到第二个周期（110 分钟）：不再保温。
  chat.last_warm_at = now - 65 * 60;
  assert.equal(await poller.maybeWarm(), false);
  assert.equal(turns.warmCalls, 0);

  // 真实消息把闲置时钟拉回 60 分钟前，保温额度重新打开。
  chat.session_bound_at = now - 60 * 60;
  chat.last_turn = { ok: true, reason: "", at: chat.session_bound_at };
  chat.last_warm_at = now - 85 * 60;
  assert.equal(await poller.maybeWarm(), true);
  assert.equal(turns.warmCalls, 1);
});

test("heartbeat never warms a session that is already past the second cycle", async () => {
  const { state, poller, turns } = setup();
  warmChat(state, { idleMin: 120 });
  // 插件睡眠/重启错过了保温窗口，也仍然不焐：下一条消息会直接换会话。
  assert.equal(await poller.maybeWarm(), false);
  assert.equal(turns.warmCalls, 0);
});

test("a cancelled warm is not recorded as the one warm", async () => {
  const { state, poller, turns } = setup();
  const chat = warmChat(state);
  turns.warmResult = { ok: false, reason: "cancelled" };
  assert.equal(await poller.maybeWarm(), true);
  assert.equal(turns.warmCalls, 1);
  assert.equal(chat.last_warm_at, 0);
});

test("heartbeat skips pending chats, active turns, unwatched, and warm_min=0", async () => {
  const { state, poller, turns } = setup();
  const chat = warmChat(state);
  state.mergeRecent(chat, [msg("m1", 1010, { kind: "dm", state: "new" })]);
  assert.equal(await poller.maybeWarm(), false);   // 有待回：交给正常唤醒
  turns.warmCalls = 0;

  state.setMessageState("feishu", "m1", "replied");
  turns.active.add("feishu:oc_warm");
  assert.equal(await poller.maybeWarm(), false);   // 在飞
  turns.active.clear();

  chat.watching = false;
  assert.equal(await poller.maybeWarm(), false);
  chat.watching = true;

  state.data.config.dsh.warm_min = 0;
  assert.equal(await poller.maybeWarm(), false);   // 关闭
});

test("heartbeat waits for the first turn to consume the skill payload", async () => {
  const { state, poller, turns } = setup();
  const chat = warmChat(state);
  chat.prompt_session = "";
  assert.equal(await poller.maybeWarm(), false);
  assert.equal(turns.warmCalls, 0);
});

test("heartbeat skips a platform whose auth is gone", async () => {
  const { state, poller, turns } = setup();
  warmChat(state);
  poller.identity.feishu = { ok: false, self_id: null, detail: "未登录" };
  assert.equal(await poller.maybeWarm(), false);
  assert.equal(turns.warmCalls, 0);

  poller.identity.feishu = { ok: true, self_id: "ou_me" };
  assert.equal(await poller.maybeWarm(), true);
  assert.equal(turns.warmCalls, 1);
});


test("duty baseline queues only groups added after the baseline", async () => {
  const { state, poller, adapter } = setup();
  adapter.chats = [{ chat_id: "oc_old", name: "已有群", kind: "group" }];
  await poller.refreshChatlist(["feishu"]);
  assert.ok(state.data.desk.baseline_at > 0);
  const old = state.getChat("feishu", "oc_old");
  assert.equal(old.duty.state, "none");

  adapter.chats.push({ chat_id: "oc_new", name: "新群", kind: "group" });
  await poller.refreshChatlist(["feishu"]);
  const fresh = state.getChat("feishu", "oc_new");
  assert.equal(fresh.duty.state, "queued");
  assert.equal(fresh.duty.trigger, "added");
  assert.equal(old.duty.state, "none");
});

test("feishu sweep uses one at-me search and ignores existing groups/@all", async () => {
  const { state, poller, adapter } = setup();
  const now = Date.now() / 1000;
  state.data.desk.baseline_at = now - 100;
  const old = state.ensureChat("feishu", "oc_old", { name: "已有群", kind: "group" });
  old.added_at = now - 200;
  const fresh = state.ensureChat("feishu", "oc_new", { name: "新群", kind: "group" });
  fresh.added_at = now - 10;
  adapter.atMe = [
    { msg_id: "om_1", sender_id: "ou_x", sender_name: "同事", content: "排期",
      ts_epoch: now - 5, mentions: [{ id: "ou_me" }], chat_id: "oc_new", chat_name: "新群" },
    { msg_id: "om_2", sender_id: "ou_x", sender_name: "同事", content: "@all 通知",
      ts_epoch: now - 5, mentions: [], chat_id: "oc_old", chat_name: "已有群" },
  ];
  await poller.maybeSweep();
  assert.equal(adapter.atMeCalls, 1);
  assert.equal(fresh.duty.state, "queued");
  assert.equal(fresh.duty.trigger, "sweep");
  assert.equal(old.duty.state, "none");
});

test("sweep skips @s older than a manual stop but still queues newer ones", async () => {
  const { state, poller, adapter } = setup();
  const now = Date.now() / 1000;
  state.data.desk.baseline_at = now - 1000;
  const chat = state.ensureChat("feishu", "oc_ignored", { name: "停盯群", kind: "group" });
  chat.added_at = now - 500;
  chat.duty.state = "ignore";
  chat.duty.by = "user";
  chat.duty.decided_at = now - 60;
  chat.duty.sweep_epoch = 0;
  const mention = (epoch) => ({
    msg_id: "om_1", sender_id: "ou_x", sender_name: "同事", content: "求开权限",
    ts_epoch: epoch, mentions: [{ id: "ou_me" }], chat_id: "oc_ignored", chat_name: "停盯群",
  });
  adapter.atMe = [mention(now - 300)];
  await poller.maybeSweep();
  assert.equal(chat.duty.state, "ignore", "停盯前的旧 @ 不应重新入队");
  assert.equal(chat.duty.event_id, "");
  assert.equal(chat.duty.sweep_epoch, 0);

  state.data.desk.last_sweep_at = 0;
  adapter.atMe = [mention(now + 10)];
  await poller.maybeSweep();
  assert.equal(chat.duty.state, "queued", "停盯之后的新 @ 仍要分诊");
  assert.equal(chat.duty.trigger, "sweep");
});

test("probe stores member count and the desk facts include it", async () => {
  const { state, poller, adapter } = setup();
  const chat = state.ensureChat("feishu", "oc_g", { name: "项目群", kind: "group" });
  adapter.memberCount = 11;
  const msgs = [msg("m1", 1010, { mentions: [{ id: "ou_me" }] })];
  adapter.messages = msgs;
  const out = await poller.probeForDuty(chat);
  assert.equal(out.length, 1);
  assert.equal(chat.duty.member_count, 11);
  const facts = poller.dutyFacts(chat);
  assert.equal(facts.member_count, 11);
  assert.equal(facts.member_limit, 10);
  assert.equal(out[0].kind, "mention");
});


function duty_new(chat) {
  chat.duty = { ...chat.duty, state: "queued", trigger: "added",
    event_id: "d-" + Math.random().toString(16).slice(2), event_at: Date.now() / 1000,
    attempts: 0, error: "" };
}

test("queued duty triage opens the desk and applies a valid decision file", async () => {
  const { state, poller, adapter } = setup();
  const now = Date.now() / 1000;
  const chat = state.ensureChat("feishu", "oc_triage", { name: "新项目群", kind: "group" });
  chat.added_at = now;
  adapter.messages = [msg("m1", now - 1, { mentions: [{ id: "ou_me" }] })];
  duty_new(chat);
  const opened = [];
  poller.turns = {
    hostReady: () => true,
    deskBusy: () => false,
    profiles: { ensureMemory() {} },
    async deskTriage(c, { eventId, onDone }) {
      const file = path.join(state.dir, "duty", "decisions", `${eventId}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        version: 1, decision_id: eventId, platform: "feishu", chat_id: "oc_triage",
        action: "watch", reason: "项目群，@ 你排期", confidence: 0.8,
      }));
      await onDone({ ok: true });
      return { ok: true, started: true };
    },
    async open(c, opts) { opened.push(opts); return { ok: true }; },
    cancel() {},
  };
  await poller.maybeTriage();
  assert.equal(chat.watching, true);
  assert.equal(chat.timer, 1);
  assert.equal(chat.duty.state, "watch");
  assert.equal(chat.duty.trigger, "mentioned");
  assert.equal(opened.length, 1);
  assert.equal(fs.existsSync(path.join(state.dir, "duty", "decisions", `${chat.duty.event_id}.json`)), false);
});

test("sweep probe is read-only: no recent/watermark changes, only sweep_epoch", async () => {
  const { state, poller, adapter } = setup();
  const chat = state.ensureChat("feishu", "oc_sweep", { name: "新群", kind: "group" });
  chat.last_epoch = 100;
  chat.last_msg_id = "m0";
  chat.recent = [{ msg_id: "m0", kind: "fyi", state: "ignored", content: "" }];
  adapter.messages = [msg("m2", 200, { mentions: [{ id: "ou_me" }] })];
  await poller.probeForDuty(chat, { readOnly: true });
  assert.equal(chat.last_epoch, 100);
  assert.equal(chat.last_msg_id, "m0");
  assert.deepEqual(chat.recent.map((m) => m.msg_id), ["m0"]);
  assert.equal(chat.duty.sweep_epoch, 200);
});

test("trial review runs once and applies ignore; attempts are reset on success", async () => {
  const { state, poller, adapter } = setup();
  const chat = state.ensureChat("feishu", "oc_review", { name: "试用群", kind: "group" });
  chat.watching = true;
  chat.timer = 1;
  chat.wake_mode = "mention";
  chat.duty.state = "trial";
  chat.duty.review_at = Date.now() / 1000 - 5;
  chat.duty.attempts = 0;
  chat.duty.member_count = 8;
  adapter.messages = [msg("m1", Date.now() / 1000 - 10)];
  poller.turns = {
    hostReady: () => true,
    deskBusy: () => false,
    profiles: { ensureMemory() {} },
    async deskTriage(c, { eventId, onDone }) {
      const file = path.join(state.dir, "duty", "decisions", `${eventId}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        version: 1, decision_id: eventId, platform: "feishu", chat_id: "oc_review",
        action: "ignore", reason: "试用期没有工作信号", confidence: 0.8,
      }));
      await onDone({ ok: true });
      return { ok: true, started: true };
    },
    cancel() {},
  };
  await poller.maybeReview();
  assert.equal(chat.watching, false);
  assert.equal(chat.duty.state, "ignore");
  assert.equal(chat.duty.attempts, 0);
  assert.equal(chat.duty.review_at, 0);
});


test("first refresh does a full Feishu baseline and stores full_baseline_at", async () => {
  const { state, poller, adapter } = setup();
  adapter.chats = [
    { chat_id: "oc_old_1", name: "旧群一", kind: "group" },
    { chat_id: "oc_old_2", name: "旧群二", kind: "group" },
  ];
  await poller.refreshChatlist(["feishu"]);
  assert.equal(adapter.listArgs[0].limit, 100);
  assert.equal(adapter.listArgs[0].opts.all, true);
  assert.ok(state.data.desk.baseline_at > 0);
  assert.ok(state.data.desk.full_baseline_at > 0);
  assert.deepEqual(state.data.desk.baseline_group_ids.sort(), ["oc_old_1", "oc_old_2"]);
  assert.equal(state.getChat("feishu", "oc_old_1").duty.state, "none");
  assert.equal(state.getChat("feishu", "oc_old_2").duty.state, "none");
});

test("0.18.0 upgrade full baseline clears queued added events but keeps sweep/manual", async () => {
  const { state, poller, adapter } = setup();
  const now = Date.now() / 1000;
  state.data.desk.baseline_at = now - 100;
  state.data.desk.full_baseline_at = 0;
  const old = state.ensureChat("feishu", "oc_old", { name: "旧群", kind: "group" });
  old.added_at = now - 50;
  old.duty.state = "queued";
  old.duty.trigger = "added";
  old.duty.event_id = "d-old";
  const swept = state.ensureChat("feishu", "oc_swept", { name: "被@的旧群", kind: "group" });
  swept.added_at = now - 50;
  swept.duty.state = "queued";
  swept.duty.trigger = "sweep";
  swept.duty.event_id = "d-sweep";
  const manual = state.ensureChat("feishu", "oc_manual", { name: "手动", kind: "group" });
  manual.added_at = now - 50;
  manual.duty.state = "queued";
  manual.duty.trigger = "manual";
  manual.duty.event_id = "d-manual";
  adapter.chats = [
    { chat_id: "oc_old", name: "旧群", kind: "group" },
    { chat_id: "oc_swept", name: "被@的旧群", kind: "group" },
    { chat_id: "oc_manual", name: "手动", kind: "group" },
  ];
  await poller.refreshChatlist(["feishu"]);
  assert.ok(state.data.desk.full_baseline_at > 0);
  assert.equal(old.duty.state, "none");
  assert.equal(swept.duty.state, "queued");
  assert.equal(manual.duty.state, "queued");

  adapter.chats.push({ chat_id: "oc_new", name: "真新群", kind: "group" });
  await poller.refreshChatlist(["feishu"]);
  assert.equal(state.getChat("feishu", "oc_new").duty.trigger, "added");
});


test("a failed full baseline is retried and not marked complete", async () => {
  const { state, poller, adapter } = setup();
  adapter.listOk = false;
  await poller.refreshChatlist(["feishu"]);
  assert.equal(state.data.desk.baseline_at, 0);
  assert.equal(state.data.desk.full_baseline_at, 0);
  adapter.listOk = true;
  await poller.refreshChatlist(["feishu"]);
  assert.ok(state.data.desk.baseline_at > 0);
  assert.ok(state.data.desk.full_baseline_at > 0);
});

test("known baseline group IDs are skipped on normal refresh, new groups still queue", async () => {
  const { state, poller, adapter } = setup();
  const now = Date.now() / 1000;
  state.data.desk.baseline_at = now - 100;
  state.data.desk.full_baseline_at = now - 90;
  state.data.desk.baseline_group_ids = ["oc_very_old"];
  adapter.chats = [
    { chat_id: "oc_very_old", name: "以前就有的群", kind: "group" },
    { chat_id: "oc_fresh", name: "今天新建的群", kind: "group" },
  ];
  await poller.refreshChatlist(["feishu"]);
  assert.equal(state.getChat("feishu", "oc_very_old"), null);
  assert.equal(state.getChat("feishu", "oc_fresh").duty.state, "queued");
});


test("auto triage over the member cap auto-ignores without a desk turn", async () => {
  const { state, poller, adapter } = setup();
  const chat = state.ensureChat("feishu", "oc_big", { name: "大群", kind: "group" });
  chat.duty = { ...chat.duty, state: "queued", trigger: "added", event_id: "d-big",
    event_at: Date.now() / 1000, attempts: 0, error: "" };
  adapter.memberCount = 175;
  adapter.memberKnown = true;
  let deskCalls = 0;
  poller.turns = {
    hostReady: () => true, deskBusy: () => false,
    async deskTriage() { deskCalls += 1; return { ok: true }; },
    cancel() {},
  };
  await poller.maybeTriage();
  assert.equal(chat.duty.state, "ignore");
  assert.equal(chat.duty.by, "system");
  assert.match(chat.duty.reason, /175/);
  assert.equal(chat.duty.member_count, 175);
  assert.equal(chat.duty.triaged_at, 0);
  assert.equal(deskCalls, 0);
  assert.equal(adapter.fetchCalls, 0);
});

test("auto triage with unknown member count also skips the desk turn", async () => {
  const { state, poller, adapter } = setup();
  const chat = state.ensureChat("feishu", "oc_unknown", { name: "未知人数群", kind: "group" });
  chat.duty = { ...chat.duty, state: "queued", trigger: "added", event_id: "d-unknown",
    event_at: Date.now() / 1000, attempts: 0, error: "" };
  adapter.memberKnown = false;
  adapter.memberCount = 0;
  let deskCalls = 0;
  poller.turns = {
    hostReady: () => true, deskBusy: () => false,
    async deskTriage() { deskCalls += 1; return { ok: true }; },
    cancel() {},
  };
  await poller.maybeTriage();
  assert.equal(chat.duty.state, "ignore");
  assert.match(chat.duty.reason, /未知/);
  assert.equal(deskCalls, 0);
});

test("fetch failure keeps last_error one line and puts the raw detail in the host log", async () => {
  const warns = [];
  const { state, poller, adapter } = setup({
    warn: (...args) => warns.push(args.join(" ")), info() {}, error() {},
  });
  adapter.fetchMessages = async () => ({
    ok: false,
    messages: [],
    error: "网络传输失败：dial tcp: i/o timeout",
    error_detail: '{"ok":false,"error":{"type":"network"}} oc_abc123…7890',
  });
  const chat = state.ensureChat("feishu", "oc_dm", { kind: "p2p" });
  chat.watching = true;
  const r = await poller.pollChat("feishu", "oc_dm");
  assert.equal(r.fetched, false);
  assert.equal(chat.last_error, "网络传输失败：dial tcp: i/o timeout");
  assert.equal(chat.last_error.includes("\n"), false);
  assert.ok(poller.errors.every((e) => !e.msg.includes("\n")));
  assert.ok(warns.some((w) => w.includes("fetch feishu/oc_dm") && w.includes("network")));
});
