import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State } from "../lib/state.js";
import { Profiles } from "../lib/profiles.js";
import { App } from "../lib/app.js";

function msg(id, epoch, extra = {}) {
  return {
    msg_id: id, sender_id: "ou_other", sender_name: "客户",
    content: `正文-${id}`, ts: `t-${epoch}`, ts_epoch: epoch,
    kind: "dm", state: "new", ...extra,
  };
}

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-app-"));
  const state = new State(dir);
  state.load();
  const profiles = new Profiles(dir);
  const calls = { send: [], wake: [], open: [], cancel: [], poll: [], fetchThread: [] };
  const turns = {
    hostReady: () => true,
    isActive: () => false,
    snapshot: () => ({}),
    async wake(chat) { calls.wake.push(chat.chat_id); return { ok: true, turn_id: "turn-1" }; },
    async open(chat) { calls.open.push(chat.chat_id); return { ok: true, started: true }; },
    cancel(platform, chatId) { calls.cancel.push(chatId); return false; },
  };
  const im = {
    adapter: () => ({
      async sendText(chatId, text) { calls.send.push({ chatId, text }); return { ok: true, message_id: "om_sent" }; },
      async search(q) { return { ok: true, items: [{ id: "oc_x", name: q }] }; },
      async searchChats(q) { return { ok: true, items: [{ chat_id: "oc_g", name: q, kind: "group" }] }; },
      async fetchMessages() { return { ok: true, messages: [] }; },
      async whoami() { return { ok: true, self_id: "ou_me", name: "我" }; },
      async listChats() { return { ok: true, items: [] }; },
    }),
  };
  const poller = {
    identity: { feishu: { ok: true, self_id: "ou_me", name: "我" } },
    errors: [],
    cycles: 3,
    started: true,
    lastCycleAt: 120,
    lastCycleMs: 12,
    async status() {
      return {
        running: true, paused: false, cycles: 3, last_cycle_at: 120, last_cycle_ms: 12,
        counts: state.counts(), platforms: [], errors: [], dsh: { configured: true },
        instances: [], turns: {}, poll: this.pollInfo(),
      };
    },
    pollInfo() {
      return { interval_min: 10, interval_sec: 600, last_result: { at: 1, chats: 1, new: 0, targets: 1 }, timer_group: 0 };
    },
    reload() {},
    turnInfo() { return { state: "idle", since: 0, last_ok: null, last_reason: "", last_at: 0 }; },
    candidates() { return []; },
    async pollChat(platform, chatId, opts = {}) {
      calls.poll.push({ platform, chatId, opts });
      return { fetched: true, new: 0, woke: false, items: [] };
    },
    async fetchThread() {
      calls.fetchThread.push(1);
      return {
        ok: true,
        items: [
          { msg_id: "m2", sender_id: "ou_other", sender_name: "客户", content: "在线 2", ts: "t2", ts_epoch: 102 },
          { msg_id: "m1", sender_id: "ou_me", sender_name: "我", content: "在线 1", ts: "t1", ts_epoch: 101 },
        ],
        error: "",
      };
    },
    async doctor() { return { checked_at: 1, checks: [] }; },
  };
  const app = new App({ state, im, poller, turns, profiles, logger: { error() {}, warn() {}, info() {} } });
  return { dir, state, profiles, app, calls, poller };
}

test("GET /api/status exposes panel fields and clamps config", async () => {
  const { app } = makeApp();
  const out = await app.handle("/api/status", "GET");
  assert.equal(out.status, 200);
  assert.equal(out.body.running, true);
  assert.equal(out.body.poll.interval_min, 10);
  assert.equal(out.body.config.poll.min_interval_min, 10);
  assert.equal(out.body.config.dsh.timeout, 600);
  assert.equal(out.body.config.ui, undefined);
});

test("watch creates target + profile; unwatch cancels without deleting the target", async () => {
  const { app, state, profiles, calls } = makeApp();
  let out = await app.handle("/api/watch", "POST", null, {
    platform: "feishu", chat_id: "oc_abc", name: "示例对象 A", kind: "p2p", watching: true,
  });
  assert.equal(out.body.ok, true);
  const chat = state.getChat("feishu", "oc_abc");
  assert.equal(chat.watching, true);
  assert.equal(chat.target, true);
  assert.ok(fs.existsSync(profiles.pathFor("feishu", "oc_abc", "示例对象 A")));
  assert.deepEqual(calls.open, ["oc_abc"], "加入值守立刻起一次开场会话");
  assert.equal(out.body.open.ok, true);
  assert.deepEqual(calls.poll.at(-1).opts, { name: "示例对象 A", kind: "p2p", force: true, wake: false });

  out = await app.handle("/api/unwatch", "POST", null, { platform: "feishu", chat_id: "oc_abc" });
  assert.equal(out.body.ok, true);
  assert.equal(chat.watching, false);
  assert.equal(chat.target, true);
  assert.deepEqual(calls.cancel, ["oc_abc"]);
});

test("inbox groups derive previews from recent only", async () => {
  const { app, state } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A", kind: "p2p" });
  chat.watching = true;
  state.mergeRecent(chat, [msg("m2", 102), msg("m1", 101, { state: "opened" })]);
  const out = await app.handle("/api/inbox", "GET", new URLSearchParams("filter=todo&limit=40"));
  assert.equal(out.body.grouped, true);
  assert.equal(out.body.items.length, 1);
  assert.equal(out.body.items[0].chat_name, "示例对象 A");
  assert.equal(out.body.items[0].count, 2);
  assert.equal(out.body.items[0].preview[0].msg_id, "m2");
  assert.equal(out.body.counts.todo, 2);
});

test("thread reads online messages and overlays cached states", async () => {
  const { app, state } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A", kind: "p2p" });
  state.mergeRecent(chat, [msg("m2", 102, { state: "opened" })]);
  const out = await app.handle("/api/thread", "GET", new URLSearchParams("platform=feishu&chat_id=oc_abc&limit=30"));
  assert.equal(out.status, 200);
  assert.equal(out.body.online, true);
  assert.equal(out.body.items.length, 2);
  assert.equal(out.body.items[0].msg_id, "m1");
  assert.equal(out.body.items[1].msg_id, "m2");
  assert.equal(out.body.items[1].state, "opened");
  assert.equal(out.body.items[0].is_self, true);
  assert.equal(out.body.chat.recent, undefined);
});

test("/api/state only affects cached messages and reports not_cached otherwise", async () => {
  const { app, state } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", {});
  state.mergeRecent(chat, [msg("m1", 101)]);
  let out = await app.handle("/api/state", "POST", null, { platform: "feishu", msg_id: "m1", state: "ignored" });
  assert.equal(out.body.ok, true);
  assert.equal(chat.recent[0].state, "ignored");
  out = await app.handle("/api/state", "POST", null, { platform: "feishu", msg_id: "old", state: "ignored" });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "not_cached");
});

test("targets page reads profile files and saves by unique display name", async () => {
  const { app, state, profiles } = makeApp();
  state.ensureChat("feishu", "oc_a", { name: "同名", kind: "p2p", target: true });
  state.ensureChat("feishu", "oc_b", { name: "同名", kind: "p2p", target: true });
  let out = await app.handle("/api/targets", "GET");
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.items.map((t) => t.name).sort(), ["同名", "同名 (2)"]);
  const target = out.body.items.find((t) => t.name === "同名 (2)");
  assert.equal(target.chat_id, "oc_b");
  assert.match(target.profile, /^# 同名/m);

  out = await app.handle("/api/targets/profile", "POST", null, {
    platform: "feishu", name: "同名 (2)", text: "# 同名\n\n- 第二个对象\n",
  });
  assert.equal(out.body.ok, true);
  assert.match(fs.readFileSync(profiles.pathFor("feishu", "oc_b", "同名"), "utf8"), /第二个对象/);
});

test("chatWake refuses blocked/unwatched and starts a real turn for pending", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A", kind: "p2p" });
  state.mergeRecent(chat, [msg("m1", 101)]);

  let out = await app.handle("/api/chat/wake", "POST", null, { platform: "feishu", chat_id: "oc_abc" });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "not_watching");

  chat.watching = true;
  out = await app.handle("/api/chat/wake", "POST", null, { platform: "feishu", chat_id: "oc_abc" });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.pending, 1);
  assert.deepEqual(calls.wake, ["oc_abc"]);
});

test("chatWake refuses when there is nothing pending", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A", kind: "p2p" });
  chat.watching = true;
  state.mergeRecent(chat, [msg("m1", 101, { state: "replied" })]);
  const out = await app.handle("/api/chat/wake", "POST", null, {
    platform: "feishu", chat_id: "oc_abc",
  });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "no_pending");
  assert.equal(out.body.pending, 0);
  assert.deepEqual(calls.wake, []);
});

test("block marks pending as ignored, clears bodies and cancels the turn", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A", kind: "p2p" });
  chat.watching = true;
  state.mergeRecent(chat, [msg("m1", 101)]);
  const out = await app.handle("/api/chat/block", "POST", null, {
    platform: "feishu", chat_id: "oc_abc", blocked: true,
  });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.ignored, 1);
  assert.equal(chat.recent[0].state, "ignored");
  assert.equal(chat.recent[0].content, "");
  assert.ok(chat.blocked_at > 0);
  assert.deepEqual(calls.cancel, ["oc_abc"]);
});

test("manual send uses the platform adapter and closes the pending pointer", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", {});
  state.mergeRecent(chat, [msg("m1", 101)]);
  const out = await app.handle("/api/send", "POST", null, {
    platform: "feishu", chat_id: "oc_abc", text: "我来回", msg_id: "m1",
  });
  assert.equal(out.body.ok, true);
  assert.deepEqual(calls.send, [{ chatId: "oc_abc", text: "我来回" }]);
  assert.equal(chat.recent[0].state, "replied");
  assert.equal(chat.recent[0].content, "");
});

test("GET routes accept query-string params like the contract says", async () => {
  const { app, state } = makeApp();
  const q = new URLSearchParams("platform=feishu&chat_id=oc_q&name=Query&kind=p2p&watching=1");
  const out = await app.handle("/api/watch", "GET", q);
  assert.equal(out.body.ok, true);
  assert.equal(state.getChat("feishu", "oc_q").watching, true);
  const s = await app.handle("/api/chat/session", "GET", new URLSearchParams("platform=feishu&chat_id=oc_q"));
  assert.equal(s.body.ok, true);
  assert.equal(s.body.session_id, "");
});

test("unknown routes and wrong methods 404 without leaking", async () => {
  const { app } = makeApp();
  assert.equal((await app.handle("/api/nope", "GET")).status, 404);
  assert.equal((await app.handle("/api/watch", "GET")).status, 200); // GET route exists but needs params
  assert.equal((await app.handle("/api/forget", "GET")).status, 404);
});

test("config POST clamps and persists", async () => {
  const { app, state } = makeApp();
  const out = await app.handle("/api/config", "POST", null, { poll: { interval_min: 1, per_chat_limit: 5 } });
  assert.equal(out.body.poll.interval_min, 10);
  assert.equal(state.data.config.poll.per_chat_limit, 5);
  assert.equal((await app.handle("/api/config", "GET")).body.poll.interval_min, 10);
});

test("opening a thread only polls; it never starts a turn", async () => {
  const { app, calls } = makeApp();
  const out = await app.handle("/api/thread", "GET",
    new URLSearchParams("platform=feishu&chat_id=oc_abc&fetch=1&limit=30"));
  assert.equal(out.body.online, true);
  assert.equal(calls.poll.length, 1);
  assert.equal(calls.poll[0].opts.wake, false);
  assert.equal(calls.wake.length, 0);
  assert.equal(calls.fetchThread.length, 0);
});

test("manual poll no longer bypasses the cooldown with force", async () => {
  const { app, calls } = makeApp();
  await app.handle("/api/poll", "POST", null, { platform: "feishu", chat_id: "oc_abc" });
  assert.equal(calls.poll.length, 1);
  assert.notEqual(calls.poll[0].opts.force, true);
});

test("wecom group can be added by display name + chat_id", async () => {
  const { app, state } = makeApp();
  const out = await app.handle("/api/watch", "POST", null, {
    platform: "wecom", chat_id: "wr_group_1", name: "客户群", kind: "group", watching: true,
  });
  assert.equal(out.body.ok, true);
  const chat = state.getChat("wecom", "wr_group_1");
  assert.equal(chat.kind, "group");
  assert.equal(chat.watching, true);
  assert.equal(chat.name, "客户群");
  assert.ok(out.body.chat);
  assert.equal(out.body.chat.recent, undefined);
});

test("dingtalk joins watch and auto-enables; unknown platforms are rejected", async () => {
  const { app, state } = makeApp();
  const legacy = state.ensureChat("dingtalk", "cid_legacy", { name: "钉钉旧会话", kind: "p2p" });
  legacy.watching = true;
  const out = await app.handle("/api/watch", "POST", null, {
    platform: "dingtalk", chat_id: "cid_new", name: "新会话", kind: "p2p",
  });
  assert.equal(out.body.ok, true);
  assert.ok(state.getChat("dingtalk", "cid_new"));
  assert.ok(state.data.config.platforms.includes("dingtalk"));

  const off = await app.handle("/api/platforms", "POST", null,
    { platform: "dingtalk", enabled: false });
  assert.equal(off.body.ok, true);
  assert.equal(state.data.config.platforms.includes("dingtalk"), false);

  const on = await app.handle("/api/platforms", "POST", null,
    { platform: "dingtalk", enabled: true });
  assert.equal(on.body.ok, true);
  assert.ok(state.data.config.platforms.includes("dingtalk"));

  const bad = await app.handle("/api/watch", "POST", null, { platform: "slack", chat_id: "x" });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.reason, /不支持/);
});

test("chat mode writes watching/timer/wake_mode in one call and refuses non-groups", async () => {
  const { app, state, calls } = makeApp();
  let out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_grp", name: "示例群", kind: "group", mode: "all",
  });
  assert.equal(out.body.ok, true);
  const chat = state.getChat("feishu", "oc_grp");
  assert.equal(chat.watching, true);
  assert.equal(chat.timer, 1);
  assert.equal(chat.wake_mode, "all");
  assert.equal(out.body.chat.wake_mode, "all");

  out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_grp", mode: "mention",
  });
  assert.equal(chat.wake_mode, "mention");
  assert.equal(chat.timer, 1);

  out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_grp", mode: "off",
  });
  assert.equal(chat.watching, false);
  assert.equal(chat.timer, -1);
  assert.deepEqual(calls.cancel, ["oc_grp"]);

  out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_dm", kind: "p2p", mode: "all",
  });
  assert.equal(out.body.ok, false);
  assert.match(out.body.reason, /只对群/);
});

test("joining watch on a group defaults to mention mode and starts polling", async () => {
  const { app, state } = makeApp();
  const out = await app.handle("/api/watch", "POST", null, {
    platform: "feishu", chat_id: "oc_g9", name: "示例群", kind: "group", watching: true,
  });
  assert.equal(out.body.ok, true);
  const chat = state.getChat("feishu", "oc_g9");
  assert.equal(chat.watching, true);
  assert.equal(chat.timer, 1, "群加入值守应当真的拉起来");
  assert.equal(chat.wake_mode, "mention", "默认只盯 @我");
  assert.equal(out.body.chat.wake_mode, "mention");
});

test("a failed opening turn never fails the join itself", async () => {
  const { app, state } = makeApp();
  app.turns.open = async () => { throw new Error("session_locked_other_host"); };
  const out = await app.handle("/api/watch", "POST", null, {
    platform: "feishu", chat_id: "oc_half", name: "示例对象 B", kind: "p2p", watching: true,
  });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.open.ok, false);
  assert.match(out.body.open.reason, /session_locked_other_host/);
  assert.equal(state.getChat("feishu", "oc_half").watching, true, "值守状态已经保存");
});

test("switching a group from off to mention opens a session; re-joining does not", async () => {
  const { app, state, calls } = makeApp();
  await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_g10", name: "示例群", kind: "group", mode: "mention",
  });
  assert.deepEqual(calls.open, ["oc_g10"]);
  const before = state.getChat("feishu", "oc_g10");
  assert.equal(before.watching, true);

  await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_g10", mode: "all",
  });
  assert.deepEqual(calls.open, ["oc_g10"], "已在值守的会话再切模式不重复开会话");
});
