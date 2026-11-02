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
    this.self = { ok: true, self_id: "ou_me", name: "我", detail: "" };
  }
  async whoami() { return this.self; }
  async fetchMessages(chatId, { limit = 10 } = {}) {
    this.calls.push({ chatId, limit });
    return { ok: true, messages: this.messages.slice(0, limit) };
  }
  async listChats() { return { ok: true, items: this.chats }; }
  async sendText() { return { ok: true, message_id: "om_sent" }; }
  async search() { return { ok: true, items: [] }; }
  async searchChats() { return { ok: true, items: [] }; }
}

class FakeTurns {
  constructor() { this.active = new Set(); this.wakes = []; }
  hostReady() { return true; }
  isActive(platform, chatId) { return this.active.has(`${platform}:${chatId}`); }
  async wake(chat, opts = {}) {
    this.wakes.push({ chat, opts });
    return { ok: true, started: true, turn_id: `turn-${this.wakes.length}` };
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
  assert.equal(turns.wakes.at(-1).opts.retry, true);
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
