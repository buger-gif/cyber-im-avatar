import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State } from "../lib/state.js";
import { Poller } from "../lib/poller.js";

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
    this.self = { ok: true, self_id: "ou_me", name: "我", detail: "" };
  }
  async whoami() { return this.self; }
  async fetchMessages(chatId, { limit = 10 } = {}) {
    this.calls.push({ chatId, limit });
    return { ok: true, messages: this.messages.slice(0, limit) };
  }
  async listChats() { this.listCalls += 1; return { ok: true, items: this.chats }; }
  async sendText() { return { ok: true, message_id: "om_sent" }; }
  async search() { return { ok: true, items: [] }; }
  async searchChats() { return { ok: true, items: [] }; }
}

class FakeTurns {
  constructor() {
    this.active = new Set();
    this.wakes = [];
    this.warmCalls = 0;
    this.warmResult = { ok: true, started: true };
  }
  hostReady() { return true; }
  isActive(platform, chatId) { return this.active.has(`${platform}:${chatId}`); }
  async wake(chat, opts = {}) {
    this.wakes.push({ chat, opts });
    return { ok: true, started: true, turn_id: `turn-${this.wakes.length}` };
  }
  async warm(chat) {
    this.warmCalls += 1;
    this.lastWarmChat = chat;
    return this.warmResult;
  }
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-poll-"));
  const state = new State(dir);
  state.load();
  state.data.config.poll.refresh_chatlist = false;
  state.data.config.poll.cooldown_sec = 0;
  const im = { adapter: () => adapter };
  const adapter = new FakeAdapter();
  const poller = new Poller({ state, im, logger: { warn() {}, info() {}, error() {} } });
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

test("self-@ wakes in DM all mode too, and never in groups", async () => {
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

  // 群里的自己消息（哪怕 @ 自己）不特殊处理，仍是 out、不唤醒。
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
  assert.equal(r.woke, false);
  assert.equal(turns.wakes.length, 1);
  assert.equal(grp.recent.find((m) => m.msg_id === "g2").kind, "out");
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

  // 同一会话刚跑过保温：即使 last_warm_at 只有一份，也要等下一个窗口。
  chat.last_warm_at = Date.now() / 1000;
  assert.equal(await poller.maybeWarm(), false);
  assert.equal(turns.warmCalls, 1);

  // 启动失败也退避，不每个 tick 重试。
  chat.last_warm_at = 0;
  turns.warmResult = { ok: false, reason: "no_session" };
  assert.equal(await poller.maybeWarm(), true);
  assert.equal(turns.warmCalls, 2);
  assert.equal(chat.last_warm_ok, false);
  assert.ok(chat.last_warm_at > 0);
  assert.equal(await poller.maybeWarm(), false);
  assert.equal(turns.warmCalls, 2);
});

test("heartbeat skips pending chats, active turns, unwatched, and the reset window", async () => {
  const { state, poller, turns } = setup();
  const chat = warmChat(state);
  state.mergeRecent(chat, [msg("m1", 1010, { kind: "dm", state: "new" })]);
  assert.equal(await poller.maybeWarm(), false);   // 有待回：交给正常唤醒
  turns.warmCalls = 0;

  state.setMessageState("feishu", "m1", "replied");
  turns.active.add("feishu:oc_warm");
  assert.equal(await poller.maybeWarm(), false);   // 在飞
  turns.active.clear();

  const old = Date.now() / 1000 - 181 * 60;
  chat.session_bound_at = old;
  chat.last_turn = { ok: true, reason: "", at: old };
  assert.equal(await poller.maybeWarm(), false);   // 已到重开阈值
  assert.equal(turns.warmCalls, 0);

  chat.session_bound_at = Date.now() / 1000 - 60 * 60;
  chat.last_turn = { ok: true, reason: "", at: chat.session_bound_at };
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

test("heartbeat keeps running when idle reset is off; both knobs are independent", async () => {
  const { state, poller, turns } = setup();
  warmChat(state, { idleMin: 60 });
  state.data.config.dsh.idle_reset_min = 0;
  assert.equal(await poller.maybeWarm(), true);
  assert.equal(turns.warmCalls, 1);
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
